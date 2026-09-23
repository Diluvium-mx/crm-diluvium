import { describe, it, expect } from "vitest";
import {
  debounceDelayMs,
  debounceWindow,
  maxModelCallsPerHour,
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

describe("decideGate (compuerta de interruptor y seguridad)", () => {
  const base: GateInput = {
    channelMode: "auto",
    agentState: "activo",
    now: 1_000_000,
    windowExpiresAt: 1_000_000 + 3600 * S, // dentro de 24h
    humanRepliedSincePending: false,
    agentRepliesLastHour: 0,
    antiLoopMaxPerHour: 30,
    modelCallsLastHour: 0,
    orgSpendLast24hUsd: 0,
    agentSendUnresolved: false,
    dailyBudgetUsd: 20,
    agentRepliesToContact: 0,
    maxRepliesPerContact: null,
  };

  it("canal off (o el viejo modo borrador) → no responde", () => {
    expect(decideGate({ ...base, channelMode: "off" })).toEqual({ action: "skip", reason: "canal_off" });
    expect(decideGate({ ...base, channelMode: "borrador" })).toEqual({ action: "skip", reason: "canal_off" });
  });

  it("pausado (un vendedor contestó) → calla hasta Reactivar; ninguna pausa vence sola", () => {
    expect(decideGate({ ...base, agentState: "pausado_humano" })).toEqual({ action: "skip", reason: "pausado_humano" });
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

  it("anti-bucle: tope/hora (30) → no responde esa vez y avisa; nunca pausa ni etiqueta", () => {
    expect(decideGate({ ...base, agentRepliesLastHour: 29 }).action).toBe("respond");
    expect(decideGate({ ...base, agentRepliesLastHour: 30 })).toEqual({ action: "skip", reason: "anti_bucle", notice: "anti_bucle" });
  });

  it("tope de gasto: muchas llamadas sin respuesta (descartes) → no responde y avisa, sin pausar", () => {
    // antiLoop 30/h → tope 120 llamadas/h (4 por respuesta: filtro + cerebro + holgura).
    expect(maxModelCallsPerHour(30)).toBe(120);
    expect(maxModelCallsPerHour(1)).toBe(12);
    expect(decideGate({ ...base, modelCallsLastHour: 119 }).action).toBe("respond");
    expect(decideGate({ ...base, agentRepliesLastHour: 0, modelCallsLastHour: 120 })).toEqual({
      action: "skip",
      reason: "tope_de_llamadas",
      notice: "anti_bucle",
    });
  });

  it("envío del agente en camino (o plan de burbujas enviando): espera, sin pausar", () => {
    expect(decideGate({ ...base, agentSendUnresolved: true })).toEqual({ action: "skip", reason: "envio_sin_confirmar" });
  });

  it("presupuesto diario de la organización: al llegar, no responde y avisa (sin pausar la conversación)", () => {
    expect(decideGate({ ...base, orgSpendLast24hUsd: 19.99 }).action).toBe("respond");
    expect(decideGate({ ...base, orgSpendLast24hUsd: 20 })).toEqual({
      action: "skip",
      reason: "presupuesto_diario",
      notice: "presupuesto",
    });
  });

  it("tope por contacto (si se activa) → no responde y avisa; null = sin tope", () => {
    expect(decideGate({ ...base, maxRepliesPerContact: 3, agentRepliesToContact: 3 })).toEqual({
      action: "skip",
      reason: "tope_por_contacto",
      notice: "tope_contacto",
    });
    expect(decideGate({ ...base, maxRepliesPerContact: null, agentRepliesToContact: 999 }).action).toBe("respond");
  });

  it("camino feliz → responde", () => {
    expect(decideGate(base)).toEqual({ action: "respond" });
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
