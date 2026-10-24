// Reglas de la tormenta (puras, con pruebas en rules.test.ts): cuánto sube por segundo el medidor
// «Agua dentro de la casa» y en qué orden se pueden poner las piezas.
//
// Orden (indicación del dueño, 14-oct-2026): afuera, la Plastiloka (solo al inicio) y luego la tira de
// hule; se abre la puerta y, adentro, la compuerta y la matraca (primero el gato, después los tornillos).

export const RULES = {
  // Afuera, con la puerta cerrada, casi no se mete.
  closedBase: 0.002,
  closed: 0.08,
  // Puerta abierta sin compuerta: entra rápido.
  noGateBase: 0.008,
  noGate: 0.35,
  // Con la compuerta puesta siempre entra MENOS que sin ella; lo que queda se reparte entre el gato
  // suelto y los tornillos sueltos (jack + bolts = 1).
  withGate: 0.2,
  jack: 0.6,
  bolts: 0.4,
  jackClicks: 6,
  boltClicks: 3,
  puttyClicks: 3,
  kneads: 8,
};

export type StormState = {
  inside: boolean;
  // 0 = sin tira, 1 = el rollo ya está en el marco, 2 = tira completa.
  strip: 0 | 1 | 2;
  stripP: number;
  gate: boolean;
  jack: number;
  bolts: number[];
  putty: number[];
  kneads: number;
  mistakes: number;
  penalty: number;
  phase: "out" | "opening" | "in";
};

export function freshState(): StormState {
  return { inside: false, strip: 0, stripP: 0, gate: false, jack: 0, bolts: [0, 0, 0], putty: [0, 0], kneads: 0, mistakes: 0, penalty: 0, phase: "out" };
}

// excess = metros que el agua pasó el piso de la entrada.
export function leakRate(st: StormState, excess: number): number {
  if (excess <= 0) return 0;
  if (!st.inside) return RULES.closedBase + excess * RULES.closed;
  if (!st.gate) return RULES.noGateBase + excess * RULES.noGate;
  const jack = 1 - Math.min(1, st.jack / RULES.jackClicks);
  const bolts = 1 - st.bolts.reduce((a, b) => a + Math.min(1, b / RULES.boltClicks), 0) / st.bolts.length;
  return excess * RULES.withGate * (jack * RULES.jack + bolts * RULES.bolts);
}

export const puttyDone = (st: StormState) => st.putty.every((c) => c >= RULES.puttyClicks);
export const jackDone = (st: StormState) => st.jack >= RULES.jackClicks;
export const boltsDone = (st: StormState) => st.bolts.every((b) => b >= RULES.boltClicks);
export const sealed = (st: StormState) => puttyDone(st) && st.strip === 2 && st.gate && jackDone(st) && boltsDone(st);

export function canPlace(st: StormState, kind: "putty" | "roll" | "gate"): boolean {
  if (kind === "putty") return !puttyDone(st) && st.strip === 0;
  if (kind === "roll") return puttyDone(st) && st.strip === 0;
  return st.inside && st.strip === 2 && !st.gate;
}

// ¿Este tornillo se puede apretar ya? El gato va primero.
export function canTurn(st: StormState, head: { type: "jack" | "bolt"; i: number }): boolean {
  if (head.type === "jack") return !jackDone(st);
  return jackDone(st) && st.bolts[head.i] < RULES.boltClicks;
}
