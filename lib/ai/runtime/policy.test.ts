import { describe, it, expect } from "vitest";
import {
  debounceDelayMs,
  debounceWindow,
  maxModelCallsPerHour,
  pauseElapsed,
  decideGate,
  rescheduleDelayMs,
  toBubbles,
  type GateInput,
} from "./policy";

const S = 1000;

describe("debounceDelayMs (debounce deslizante con tope)", () => {
  it("3 mensajes en 5s → una sola espera desde el último (15s)", () => {
    // t=0,2,4s; al llegar el 3º (t=4) se reprograma a 4+15=19s. now=4s.
    const d = debounceDelayMs({
      now: 4 * S,
      firstPendingAt: 0,
      lastInboundAt: 4 * S,
      responseDelaySeconds: 15,
      maxWaitSeconds: 60,
    });
    expect(d).toBe(15 * S); // una sola respuesta cubrirá los 3
  });

  it("respeta el tope máximo si el cliente sigue escribiendo", () => {
    // firstPending=0, último entrante a los 55s; soft=55+15=70 pero hard=0+60=60.
    const d = debounceDelayMs({
      now: 55 * S,
      firstPendingAt: 0,
      lastInboundAt: 55 * S,
      responseDelaySeconds: 15,
      maxWaitSeconds: 60,
    });
    expect(d).toBe(5 * S); // dispara al tope (60s), no a los 70s
  });

  it("nunca es negativo (el tope ya venció)", () => {
    const d = debounceDelayMs({
      now: 100 * S,
      firstPendingAt: 0,
      lastInboundAt: 100 * S,
      responseDelaySeconds: 15,
      maxWaitSeconds: 60,
    });
    expect(d).toBe(0);
  });

  it("al volver al debounce tras descartar, nunca 0: espera al menos responseDelaySeconds", () => {
    const i = { now: 100 * S, firstPendingAt: 0, lastInboundAt: 100 * S, responseDelaySeconds: 15, maxWaitSeconds: 60 };
    expect(rescheduleDelayMs(i)).toBe(15 * S);
    expect(rescheduleDelayMs({ ...i, now: 4 * S, lastInboundAt: 4 * S })).toBe(15 * S);
  });
});

describe("debounceWindow (qué pendientes cuentan para el debounce)", () => {
  it("sin cortes: del más viejo al más nuevo", () => {
    expect(debounceWindow([5 * S, 1 * S, 3 * S], [])).toEqual({ firstPendingAt: 1 * S, lastInboundAt: 5 * S });
  });
  it("un pendiente viejo ya atendido (o previo a reactivar/encender) no vence el tope", () => {
    expect(debounceWindow([0, 100 * S, 102 * S], [10 * S, null])).toEqual({ firstPendingAt: 100 * S, lastInboundAt: 102 * S });
    expect(debounceWindow([0, 100 * S], [null, 50 * S, 20 * S])).toEqual({ firstPendingAt: 100 * S, lastInboundAt: 100 * S });
  });
  it("todo anterior al corte → cuenta solo el último; sin pendientes → null", () => {
    expect(debounceWindow([1 * S, 2 * S], [9 * S])).toEqual({ firstPendingAt: 2 * S, lastInboundAt: 2 * S });
    expect(debounceWindow([], [9 * S])).toBeNull();
  });
});

describe("pauseElapsed (reactivación por vencimiento)", () => {
  const now = 1_000_000;
  it("handover vencido → true", () => {
    expect(pauseElapsed("pausado_handover", now - 1, now)).toBe(true);
  });
  it("handover aún vigente → false", () => {
    expect(pauseElapsed("pausado_handover", now + 10 * S, now)).toBe(false);
  });
  it("humano/antibucle nunca vencen solos", () => {
    expect(pauseElapsed("pausado_humano", now - 1, now)).toBe(false);
    expect(pauseElapsed("pausado_antibucle", null, now)).toBe(false);
  });
});

describe("decideGate (compuerta de interruptor y seguridad)", () => {
  const base: GateInput = {
    channelMode: "auto",
    agentState: "activo",
    agentPausedUntil: null,
    now: 1_000_000,
    windowExpiresAt: 1_000_000 + 3600 * S, // dentro de 24h
    humanRepliedSincePending: false,
    agentRepliesLastHour: 0,
    antiLoopMaxPerHour: 10,
    modelCallsLastHour: 0,
    orgSpendLast24hUsd: 0,
    dailyBudgetUsd: 20,
    agentRepliesToContact: 0,
    maxRepliesPerContact: null,
  };

  it("canal off → no responde", () => {
    expect(decideGate({ ...base, channelMode: "off" })).toEqual({ action: "skip", reason: "canal_off" });
  });

  it("pausado_humano → calla", () => {
    expect(decideGate({ ...base, agentState: "pausado_humano" }).action).toBe("skip");
  });

  it("handover vigente calla; handover vencido responde y reactiva", () => {
    const vigente = decideGate({ ...base, agentState: "pausado_handover", agentPausedUntil: base.now + 5 * S });
    expect(vigente).toEqual({ action: "skip", reason: "pausado_handover" });
    const vencido = decideGate({ ...base, agentState: "pausado_handover", agentPausedUntil: base.now - 1 });
    expect(vencido).toEqual({ action: "respond", mode: "auto", reactivated: true });
  });

  it("respuesta humana en el hilo → pausa a pausado_humano", () => {
    expect(decideGate({ ...base, humanRepliedSincePending: true })).toEqual({
      action: "skip",
      reason: "respuesta_humana",
      pauseTo: "pausado_humano",
    });
  });

  it("fuera de la ventana de 24h (o sin ventana) → no responde", () => {
    expect(decideGate({ ...base, now: base.windowExpiresAt! + 1 }).action).toBe("skip");
    expect(decideGate({ ...base, windowExpiresAt: null }).action).toBe("skip");
  });

  it("anti-bucle: tope/hora → pausa + etiqueta revisión humana", () => {
    expect(decideGate({ ...base, agentRepliesLastHour: 10 })).toEqual({
      action: "skip",
      reason: "anti_bucle",
      pauseTo: "pausado_antibucle",
      tag: "revisión humana",
    });
  });

  it("tope de gasto: muchas llamadas sin respuesta (descartes) → pausa + revisión humana", () => {
    // antiLoop 10/h → tope 40 llamadas/h (4 por respuesta: filtro + cerebro + holgura).
    expect(maxModelCallsPerHour(10)).toBe(40);
    expect(maxModelCallsPerHour(1)).toBe(12);
    expect(decideGate({ ...base, modelCallsLastHour: 39 }).action).toBe("respond");
    expect(decideGate({ ...base, agentRepliesLastHour: 0, modelCallsLastHour: 40 })).toEqual({
      action: "skip",
      reason: "tope_de_llamadas",
      pauseTo: "pausado_antibucle",
      tag: "revisión humana",
    });
  });

  it("presupuesto diario de la organización: al llegar, no responde (sin pausar la conversación)", () => {
    expect(decideGate({ ...base, orgSpendLast24hUsd: 19.99 }).action).toBe("respond");
    expect(decideGate({ ...base, orgSpendLast24hUsd: 20 })).toEqual({ action: "skip", reason: "presupuesto_diario" });
  });

  it("tope por contacto (si se activa) → no responde; null = sin tope", () => {
    expect(decideGate({ ...base, maxRepliesPerContact: 3, agentRepliesToContact: 3 }).action).toBe("skip");
    expect(decideGate({ ...base, maxRepliesPerContact: null, agentRepliesToContact: 999 }).action).toBe("respond");
  });

  it("camino feliz respeta el modo del canal (auto/borrador)", () => {
    expect(decideGate(base)).toEqual({ action: "respond", mode: "auto", reactivated: false });
    expect(decideGate({ ...base, channelMode: "borrador" })).toEqual({
      action: "respond",
      mode: "borrador",
      reactivated: false,
    });
  });

  it("prioridad: el interruptor off gana incluso si hay respuesta humana", () => {
    expect(decideGate({ ...base, channelMode: "off", humanRepliedSincePending: true })).toEqual({
      action: "skip",
      reason: "canal_off",
    });
  });
});

describe("toBubbles (máx 2 burbujas por doble salto)", () => {
  it("un bloque → una burbuja", () => {
    expect(toBubbles("hola")).toEqual(["hola"]);
  });
  it("dos bloques → dos burbujas", () => {
    expect(toBubbles("info aquí\n\n¿una pregunta?")).toEqual(["info aquí", "¿una pregunta?"]);
  });
  it("tres+ bloques → se limita a 2, sin perder texto", () => {
    expect(toBubbles("a\n\nb\n\nc")).toEqual(["a", "b\n\nc"]);
  });
  it("recorta y descarta bloques vacíos", () => {
    expect(toBubbles("  a  \n\n\n  b  ")).toEqual(["a", "b"]);
  });
});
