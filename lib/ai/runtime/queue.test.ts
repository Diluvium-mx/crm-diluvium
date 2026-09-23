import { describe, expect, it, vi } from "vitest";
import {
  acquireLock,
  cancelAgentRun,
  dirtyKey,
  releaseLock,
  scheduleAgentRun,
  type AgentJob,
  type AgentJobHandle,
  type AgentQueuePort,
  type KvPort,
} from "./queue";
import { LOCKED_RETRY_MS, processAgentJob, type ProcessDeps } from "./process";

// Cola en memoria que imita a BullMQ: un job por jobId; add con id repetido se ignora.
function fakeQueue() {
  const jobs = new Map<string, { state: string; delay: number; data: AgentJob }>();
  const handle = (id: string): AgentJobHandle => ({
    getState: async () => jobs.get(id)?.state ?? "unknown",
    changeDelay: async (d) => {
      const j = jobs.get(id);
      if (!j || j.state !== "delayed") throw new Error("not delayed");
      j.delay = d;
    },
    remove: async () => {
      jobs.delete(id);
    },
  });
  const port: AgentQueuePort = {
    getJob: async (id) => (jobs.has(id) ? handle(id) : undefined),
    add: async (data, opts) => {
      if (jobs.has(opts.jobId)) return;
      jobs.set(opts.jobId, { state: opts.delay > 0 ? "delayed" : "waiting", delay: opts.delay, data });
    },
  };
  return { port, jobs };
}

function fakeKv() {
  const store = new Map<string, string>();
  const kv: KvPort = {
    setNxPx: async (k, v) => (store.has(k) ? false : (store.set(k, v), true)),
    setEx: async (k, v) => {
      store.set(k, v);
    },
    getDel: async (k) => {
      const v = store.get(k) ?? null;
      store.delete(k);
      return v;
    },
    delIfEquals: async (k, v) => {
      if (store.get(k) === v) store.delete(k);
    },
  };
  return { kv, store };
}

const data = { conversationId: "conv-1", organizationId: "org" };

describe("scheduleAgentRun (debounce deslizante, un job por conversación)", () => {
  it("3 mensajes seguidos → UN solo job, reprogramado cada vez", async () => {
    const { port, jobs } = fakeQueue();
    const { kv } = fakeKv();
    expect(await scheduleAgentRun(port, kv, data, 15_000)).toBe("added");
    expect(await scheduleAgentRun(port, kv, data, 15_000)).toBe("rescheduled");
    expect(await scheduleAgentRun(port, kv, data, 12_000)).toBe("rescheduled");
    expect(jobs.size).toBe(1);
    expect(jobs.get("conv-1")!.delay).toBe(12_000);
  });

  it("job esperando turno: no se toca (correrá y leerá lo nuevo)", async () => {
    const { port, jobs } = fakeQueue();
    const { kv } = fakeKv();
    jobs.set("conv-1", { state: "waiting", delay: 0, data });
    expect(await scheduleAgentRun(port, kv, data, 15_000)).toBe("waiting");
    expect(jobs.size).toBe(1);
  });

  it("job corriendo: deja el aviso dirty y no crea otro", async () => {
    const { port, jobs } = fakeQueue();
    const { kv, store } = fakeKv();
    jobs.set("conv-1", { state: "active", delay: 0, data });
    expect(await scheduleAgentRun(port, kv, data, 15_000)).toBe("running_marked");
    expect(store.get(dirtyKey("conv-1"))).toBe("1");
    expect(jobs.size).toBe(1);
  });

  it("job corriendo que termina justo entre medio: se agrega uno nuevo (no se pierde el aviso)", async () => {
    const { port, jobs } = fakeQueue();
    const { kv } = fakeKv();
    jobs.set("conv-1", { state: "active", delay: 0, data });
    const original = kv.setEx;
    kv.setEx = async (...args) => {
      await original(...args);
      jobs.delete("conv-1"); // el job terminó y BullMQ lo borró
    };
    expect(await scheduleAgentRun(port, kv, data, 15_000)).toBe("added");
    expect(jobs.get("conv-1")!.state).toBe("delayed");
  });

  it("job terminado/fallido que sigue en la cola se reemplaza", async () => {
    const { port, jobs } = fakeQueue();
    const { kv } = fakeKv();
    jobs.set("conv-1", { state: "failed", delay: 0, data });
    expect(await scheduleAgentRun(port, kv, data, 15_000)).toBe("added");
    expect(jobs.get("conv-1")!.state).toBe("delayed");
  });

  it("cancelAgentRun quita un job diferido pero no uno corriendo", async () => {
    const { port, jobs } = fakeQueue();
    jobs.set("conv-1", { state: "delayed", delay: 5, data });
    expect(await cancelAgentRun(port, "conv-1")).toBe(true);
    expect(jobs.size).toBe(0);
    jobs.set("conv-1", { state: "active", delay: 0, data });
    expect(await cancelAgentRun(port, "conv-1")).toBe(false);
  });
});

describe("candado por conversación", () => {
  it("solo uno a la vez; solo lo libera quien lo tiene", async () => {
    const { kv, store } = fakeKv();
    const t1 = await acquireLock(kv, "c", 1000);
    expect(t1).not.toBeNull();
    expect(await acquireLock(kv, "c", 1000)).toBeNull();
    await releaseLock(kv, "c", "otro-token");
    expect(store.size).toBe(1);
    await releaseLock(kv, "c", t1!);
    expect(await acquireLock(kv, "c", 1000)).not.toBeNull();
  });
});

describe("processAgentJob (consumer)", () => {
  function deps(
    kv: KvPort,
    run: ProcessDeps["run"],
    delayFor: ProcessDeps["delayFor"] = async () => null,
  ): ProcessDeps {
    return { kv, run, delayFor, now: () => new Date(0) };
  }

  it("candado ocupado → reintento en unos segundos, sin correr", async () => {
    const { kv } = fakeKv();
    await acquireLock(kv, "conv-1", 1000);
    const run = vi.fn();
    expect(await processAgentJob(data, deps(kv, run))).toEqual({ result: null, rescheduleMs: LOCKED_RETRY_MS });
    expect(run).not.toHaveBeenCalled();
  });

  it("si entra un mensaje mientras corre (aviso dirty), se re-programa con su debounce", async () => {
    const { kv } = fakeKv();
    const run = vi.fn(async () => {
      await kv.setEx(dirtyKey("conv-1"), "1", 60); // la ingesta avisó a mitad de la corrida
      return { kind: "sent" as const, bubbles: 1 };
    });
    const out = await processAgentJob(data, deps(kv, run, async () => 15_000));
    expect(out.rescheduleMs).toBe(15_000);
  });

  it("un aviso viejo (anterior a la corrida) no provoca otra vuelta", async () => {
    const { kv } = fakeKv();
    await kv.setEx(dirtyKey("conv-1"), "1", 60);
    const run = vi.fn(async () => ({ kind: "noop" as const, reason: "sin_pendientes" }));
    expect((await processAgentJob(data, deps(kv, run, async () => 15_000))).rescheduleMs).toBeNull();
  });

  it("libera el candado aunque la corrida falle", async () => {
    const { kv, store } = fakeKv();
    const run = vi.fn(async () => {
      throw new Error("proveedor caído");
    });
    await expect(processAgentJob(data, deps(kv, run))).rejects.toThrow("proveedor caído");
    expect([...store.keys()].some((k) => k.startsWith("agent-lock:"))).toBe(false);
  });

  it("'reschedule' del orquestador pasa tal cual", async () => {
    const { kv } = fakeKv();
    const run = vi.fn(async () => ({ kind: "reschedule" as const, delayMs: 3_000, reason: "x" }));
    expect((await processAgentJob(data, deps(kv, run))).rescheduleMs).toBe(3_000);
  });
});
