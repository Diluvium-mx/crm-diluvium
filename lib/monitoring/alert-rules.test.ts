// La desconexión alerta A CUALQUIER HORA; el silencio de entrantes, solo en horario laboral.
import { describe, expect, it } from "vitest";
import { silenceProblem, uncheckedAlert } from "./alert-rules";
import { accountProblems, type AccountOutcome } from "./zernio-account";

const down: AccountOutcome = {
  kind: "checked",
  evaluation: {
    state: {
      channelId: "ch_1",
      organizationId: "org_1",
      level: "down",
      reasons: ["desconectado"],
      checkedAt: "2026-09-27T10:00:00Z",
      downSince: "2026-09-27T09:55:00Z",
      lastConnectedAt: null,
      eventAt: null,
    },
    newEvents: [],
    healthInactivity: false,
  },
};

describe("desconexión a cualquier hora contra silencio solo en horario", () => {
  it.each([
    ["domingo 03:00 Mazatlán", "2026-09-27T10:00:00Z"],
    ["martes 23:30 Mazatlán", "2026-09-23T06:30:00Z"],
    ["martes 08:59 Mazatlán", "2026-09-22T15:59:00Z"],
  ])("%s: el silencio NO alerta, la desconexión SÍ", (_name, iso) => {
    const now = new Date(iso);
    expect(silenceProblem({ now, minutesSinceLastEvent: 600, silenceMinutes: 60 })).toBeNull();
    expect(silenceProblem({ now, minutesSinceLastEvent: null, silenceMinutes: 60 })).toBeNull();
    expect(accountProblems([down], now)[0]).toMatch(/^WhatsApp DESCONECTADO/);
  });

  it("martes 10:00 Mazatlán: alertan los dos", () => {
    const now = new Date("2026-09-22T17:00:00Z");
    expect(silenceProblem({ now, minutesSinceLastEvent: 61, silenceMinutes: 60 })).toBe(
      "sin mensajes entrantes de WhatsApp hace más de 60 min en horario laboral",
    );
    expect(silenceProblem({ now, minutesSinceLastEvent: null, silenceMinutes: 60 })).not.toBeNull();
    expect(silenceProblem({ now, minutesSinceLastEvent: 60, silenceMinutes: 60 })).toBeNull();
    expect(accountProblems([down], now)).toHaveLength(1);
  });
});

describe("'no se pudo revisar' solo alerta tras 2 revisiones seguidas (Bloque C)", () => {
  const problem = "no se pudo revisar el webhook de Zernio: Zernio respondió 502";

  it("1.ª falla: aviso al log, NO problema (no abre ni comenta el issue)", () => {
    expect(uncheckedAlert(problem, 1)).toEqual({
      problem: null,
      notice: `${problem} (1.ª vez: se avisa si se repite en la siguiente revisión)`,
    });
  });

  it("2.ª falla seguida (o más): problema", () => {
    expect(uncheckedAlert(problem, 2)).toEqual({ problem: `${problem} (2 revisiones seguidas)`, notice: null });
    expect(uncheckedAlert(problem, 5).problem).toMatch(/5 revisiones seguidas/);
  });

  it("revisó bien: nada", () => {
    expect(uncheckedAlert(null, 0)).toEqual({ problem: null, notice: null });
  });
});
