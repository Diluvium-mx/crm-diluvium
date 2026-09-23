import { describe, it, expect } from "vitest";
import {
  debounceDelayMs,
  debounceWindow,
  decideGate,
  LONG_MESSAGE_CHARS,
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
    });
    expect(d).toBe(15 * S); // una sola respuesta cubrirá los 3
  });

  it("respeta el tope máximo si el cliente sigue escribiendo", () => {
    // firstPending=0, último entrante a los 55s; soft=55+15=70 pero hard=0+60=60.
    const d = debounceDelayMs({
      now: 55 * S,
      firstPendingAt: 0,
      lastInboundAt: 55 * S,
    });
    expect(d).toBe(5 * S); // dispara al tope (60s), no a los 70s
  });

  it("nunca es negativo (el tope ya venció)", () => {
    const d = debounceDelayMs({
      now: 100 * S,
      firstPendingAt: 0,
      lastInboundAt: 100 * S,
    });
    expect(d).toBe(0);
  });

  it("al volver al debounce tras descartar, nunca 0: espera al menos los 15 s fijos", () => {
    const i = { now: 100 * S, firstPendingAt: 0, lastInboundAt: 100 * S };
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

describe("decideGate (responde todo; solo pausa un vendedor)", () => {
  const base: GateInput = {
    channelMode: "auto",
    agentState: "activo",
    now: 1_000_000,
    windowExpiresAt: 1_000_000 + 3600 * S, // dentro de 24h
    humanRepliedSincePending: false,
    agentSendUnresolved: false,
  };

  it("camino feliz → responde (sin anti-bucle, presupuesto ni topes)", () => {
    expect(decideGate(base)).toEqual({ action: "respond" });
  });

  it("canal off (o el viejo modo borrador) → no responde", () => {
    expect(decideGate({ ...base, channelMode: "off" })).toEqual({ action: "skip", reason: "canal_off" });
    expect(decideGate({ ...base, channelMode: "borrador" })).toEqual({ action: "skip", reason: "canal_off" });
  });

  it("pausado (un vendedor contestó) → calla hasta Reactivar; ninguna pausa vence sola", () => {
    expect(decideGate({ ...base, agentState: "pausado_humano" })).toEqual({ action: "skip", reason: "pausado_humano" });
  });

  it("respuesta de un vendedor en el hilo → pausa (la única)", () => {
    expect(decideGate({ ...base, humanRepliedSincePending: true })).toEqual({
      action: "skip",
      reason: "respuesta_humana",
      pauseTo: "pausado_humano",
    });
  });

  it("fuera de la ventana de 24h (o sin ventana) → no puede mandar texto", () => {
    expect(decideGate({ ...base, now: base.windowExpiresAt! + 1 }).action).toBe("skip");
    expect(decideGate({ ...base, windowExpiresAt: null }).action).toBe("skip");
  });

  it("envío del agente en camino (o plan de mensajes enviando): espera, sin pausar", () => {
    expect(decideGate({ ...base, agentSendUnresolved: true })).toEqual({ action: "skip", reason: "envio_sin_confirmar" });
  });

  it("prioridad: el interruptor off gana incluso si hay respuesta humana", () => {
    expect(decideGate({ ...base, channelMode: "off", humanRepliedSincePending: true })).toEqual({
      action: "skip",
      reason: "canal_off",
    });
  });
});

describe("toBubbles (mensajes para celular, máx 2)", () => {
  it("un bloque corto → un mensaje", () => {
    expect(toBubbles("Cuesta $5,500 con envío incluido.")).toEqual(["Cuesta $5,500 con envío incluido."]);
  });
  it("información + pregunta separadas por línea en blanco → 2 mensajes, primero la información", () => {
    expect(toBubbles("Cuesta $5,500 con envío incluido.\n\n¿Cuánto mide tu entrada?")).toEqual([
      "Cuesta $5,500 con envío incluido.",
      "¿Cuánto mide tu entrada?",
    ]);
  });
  it("un bloque largo → 2 mensajes cortados entre oraciones, sin perder texto", () => {
    const a = "La compuerta estándar mide 60 cm de alto y se ajusta al ancho de tu entrada con un marco de aluminio.";
    const b = "Se instala en minutos, no requiere obra y la puedes quitar cuando pase la lluvia para guardarla.";
    const c = "Además incluye el envío a toda la República y tiene garantía por defectos de fabricación.";
    const d = "La entrega tarda de 3 a 5 días hábiles según tu ciudad.";
    const long = `${a} ${b} ${c} ${d}`;
    expect(long.length).toBeGreaterThan(LONG_MESSAGE_CHARS);
    const out = toBubbles(long);
    expect(out).toHaveLength(2);
    expect(out.join(" ")).toBe(long);
    expect(out.every((p) => p.length < long.length)).toBe(true);
  });
  it("más de 2 bloques con pregunta al final → la información junta y la pregunta sola", () => {
    expect(toBubbles("a.\n\nb.\n\n¿Te sirve?")).toEqual(["a.\n\nb.", "¿Te sirve?"]);
  });
  it("más de 2 bloques sin pregunta → 2 mensajes de largo parecido, sin romper bloques", () => {
    expect(toBubbles("uno uno uno.\n\ndos dos.\n\ntres tres tres.")).toEqual(["uno uno uno.\n\ndos dos.", "tres tres tres."]);
  });
  it("recorta y descarta bloques vacíos", () => {
    expect(toBubbles("  a  \n\n\n  b  ")).toEqual(["a", "b"]);
    expect(toBubbles("   ")).toEqual([]);
  });
});
