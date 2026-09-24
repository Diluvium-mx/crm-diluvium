import { describe, expect, it } from "vitest";
import { resolveAgentActivity, type ActiveRun } from "./activity";

const base = { runs: [] as ActiveRun[], agentState: "activo" as const, channelMode: "auto" };
const run = (trigger: string, status = "queued", triggeredByUserId: string | null = null): ActiveRun => ({ trigger, status, triggeredByUserId });

describe("resolveAgentActivity (contratos de Fase D)", () => {
  it("a) job en delayed/waiting/prioritized sin intentos → leyendo", () => {
    for (const state of ["delayed", "waiting", "prioritized"]) {
      expect(resolveAgentActivity({ ...base, job: { state, attemptsMade: 0 } })).toBe("leyendo");
    }
  });

  it("b) job active, o delayed con intentos previos (reintento) → escribiendo", () => {
    expect(resolveAgentActivity({ ...base, job: { state: "active", attemptsMade: 0 } })).toBe("escribiendo");
    expect(resolveAgentActivity({ ...base, job: { state: "delayed", attemptsMade: 1 } })).toBe("escribiendo");
  });

  it("c) corrida queued/running del agente, palabra clave o etapa sin vendedor → enviando", () => {
    expect(resolveAgentActivity({ ...base, job: null, runs: [run("agent")] })).toBe("enviando");
    expect(resolveAgentActivity({ ...base, job: null, runs: [run("keyword", "running")] })).toBe("enviando");
    expect(resolveAgentActivity({ ...base, job: null, runs: [run("stage", "queued", null)] })).toBe("enviando");
    // Comando del vendedor o etapa movida por un vendedor: no es el agente.
    expect(resolveAgentActivity({ ...base, job: null, runs: [run("command", "running", "u1")] })).toBeNull();
    expect(resolveAgentActivity({ ...base, job: null, runs: [run("stage", "queued", "u1")] })).toBeNull();
    // Corrida terminada: nada.
    expect(resolveAgentActivity({ ...base, job: null, runs: [run("agent", "done")] })).toBeNull();
  });

  it("d) sin job ni corrida, agente pausado o canal fuera de auto → nada", () => {
    expect(resolveAgentActivity({ ...base, job: null })).toBeNull();
    expect(resolveAgentActivity({ ...base, job: { state: "completed", attemptsMade: 0 } })).toBeNull();
    expect(resolveAgentActivity({ ...base, job: { state: "active", attemptsMade: 0 }, agentState: "pausado_humano" })).toBeNull();
    expect(resolveAgentActivity({ ...base, job: { state: "active", attemptsMade: 0 }, channelMode: "borrador" })).toBeNull();
    expect(resolveAgentActivity({ ...base, job: null, runs: [run("agent")], channelMode: "off" })).toBeNull();
  });

  it("el job manda sobre las corridas: leyendo/escribiendo antes que enviando", () => {
    expect(resolveAgentActivity({ ...base, job: { state: "active", attemptsMade: 0 }, runs: [run("agent")] })).toBe("escribiendo");
  });
});
