// Guardados en serie (serial-saves.ts) con la cuenta de lo que el panel está
// guardando por carril. El tiempo real del Detalle del contacto (contact.updated)
// la consulta para no pisar un campo con un guardado en curso, ni con una lectura
// que salió ANTES de un guardado que ya terminó; y, cuando se saltó un campo por
// eso, espera a que su carril quede libre para volver a leerlo (lo que otro
// escribió en esa ventana no se pierde). Sin React, para probarlo con Vitest.
import type { SerialSaves } from "./serial-saves";

export type SaveTracker = {
  /** Úsese en lugar del SerialSaves original: mismas reglas, con la cuenta. */
  saves: SerialSaves;
  /** Foto de las versiones de cada carril, al pedir una lectura en vivo. */
  snapshot(): ReadonlyMap<string, number>;
  /** ¿El carril tiene un guardado en curso, o tuvo uno después de la foto? */
  touchedSince(lane: string, snap: ReadonlyMap<string, number>): boolean;
  /** Se resuelve cuando ninguno de esos carriles tiene guardados en curso. */
  whenIdle(lanes: readonly string[]): Promise<void>;
};

export function trackSaves(inner: SerialSaves): SaveTracker {
  const inFlight = new Map<string, number>();
  const version = new Map<string, number>();
  const waiters: { lanes: readonly string[]; resolve: () => void }[] = [];
  const bump = (lane: string) => version.set(lane, (version.get(lane) ?? 0) + 1);
  const idle = (lanes: readonly string[]) => lanes.every((lane) => (inFlight.get(lane) ?? 0) === 0);

  function release() {
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (!idle(waiters[i].lanes)) continue;
      waiters[i].resolve();
      waiters.splice(i, 1);
    }
  }

  return {
    saves: {
      save(field, send, options) {
        const lane = options?.lane ?? field;
        inFlight.set(lane, (inFlight.get(lane) ?? 0) + 1);
        bump(lane);
        return inner.save(field, send, options).finally(() => {
          inFlight.set(lane, (inFlight.get(lane) ?? 1) - 1);
          bump(lane);
          release();
        });
      },
    },
    snapshot: () => new Map(version),
    touchedSince: (lane, snap) => (inFlight.get(lane) ?? 0) > 0 || (version.get(lane) ?? 0) !== (snap.get(lane) ?? 0),
    whenIdle: (lanes) =>
      idle(lanes) ? Promise.resolve() : new Promise<void>((resolve) => waiters.push({ lanes, resolve })),
  };
}
