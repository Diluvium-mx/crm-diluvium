// Encolar una corrida (28-sep-2026): un parpadeo de Redis se reintenta de
// inmediato con el MISMO jobId, en vez de esperar al barrido del worker.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const add = vi.fn();
vi.mock("bullmq", () => ({
  Queue: class {
    add = add;
  },
}));

describe("enqueueWorkflowRun", () => {
  beforeEach(() => {
    process.env.REDIS_URL = "redis://localhost:6399";
    add.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("si el 1.er intento falla, reintenta de inmediato con el mismo jobId y encola", async () => {
    add.mockRejectedValueOnce(new Error("Connection is closed.")).mockResolvedValueOnce({ id: "wfrun_r1" });
    const { enqueueWorkflowRun, workflowJobId } = await import("./workflows");
    expect(await enqueueWorkflowRun("r1")).toBe(true);
    expect(add).toHaveBeenCalledTimes(2);
    expect(add.mock.calls.map((c) => c[2])).toEqual([{ jobId: workflowJobId("r1") }, { jobId: workflowJobId("r1") }]);
  });

  it("si los dos intentos fallan devuelve false (lo toma el barrido rápido del worker) y no lanza", async () => {
    add.mockRejectedValue(new Error("Connection is closed."));
    const { enqueueWorkflowRun } = await import("./workflows");
    expect(await enqueueWorkflowRun("r2")).toBe(false);
    expect(add).toHaveBeenCalledTimes(2);
  });
});
