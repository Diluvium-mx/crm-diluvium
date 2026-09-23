// Guardados automáticos en serie (hallazgo 4 de Codex: el autosave del panel
// "Detalle del contacto" podía quedar fuera de orden). Sin React, para probarlo
// solo con Vitest.
//
// Reglas, por CAMPO:
// - Nunca hay dos pedidos del mismo carril en vuelo: el siguiente sale cuando
//   termina el anterior, así el servidor los aplica en el orden en que se
//   pidieron. (Next hoy despacha las Server Actions de una en una, pero su
//   documentación lo llama "detalle de implementación que puede cambiar"; aquí
//   no se depende de eso.)
// - Si mientras uno vuela llegan varios del mismo campo, solo sale el último:
//   los de en medio ya son viejos y se resuelven como "superseded" sin salir.
// - Cada respuesta dice si sigue siendo la del último pedido de su campo
//   (`latest`). La interfaz solo muestra o revierte con esa; una respuesta vieja
//   nunca pisa lo que el vendedor cambió después.
//
// Un carril agrupa campos que el servidor escribe juntos (los de una entrada:
// `updateEntrada` reescribe ancho y línea en cada guardado). Por defecto, cada
// campo es su propio carril.

export type SaveOutcome<T> =
  | { status: "saved"; result: T; latest: boolean }
  | { status: "failed"; error: unknown; latest: boolean }
  | { status: "superseded" };

type Job = {
  field: string;
  /** Manda el pedido y resuelve su promesa; nunca rechaza. */
  execute: () => Promise<void>;
  /** Lo resuelve como "superseded" sin mandarlo. */
  supersede: () => void;
};

type Lane = { busy: boolean; jobs: Job[] };

export type SerialSaves = {
  save<T>(field: string, send: () => Promise<T>, lane?: string): Promise<SaveOutcome<T>>;
};

export function createSerialSaves(): SerialSaves {
  const lanes = new Map<string, Lane>();
  const latestSeq = new Map<string, number>();
  let nextSeq = 0;

  async function drain(lane: Lane): Promise<void> {
    lane.busy = true;
    for (let job = lane.jobs.shift(); job; job = lane.jobs.shift()) {
      await job.execute();
    }
    lane.busy = false;
  }

  function save<T>(field: string, send: () => Promise<T>, laneKey: string = field): Promise<SaveOutcome<T>> {
    const seq = ++nextSeq;
    latestSeq.set(field, seq);
    const isLatest = () => latestSeq.get(field) === seq;

    const lane = lanes.get(laneKey) ?? { busy: false, jobs: [] };
    lanes.set(laneKey, lane);
    // Un pedido del mismo campo que todavía no sale ya es viejo.
    for (const old of lane.jobs.filter((job) => job.field === field)) old.supersede();
    lane.jobs = lane.jobs.filter((job) => job.field !== field);

    return new Promise<SaveOutcome<T>>((resolve) => {
      lane.jobs.push({
        field,
        supersede: () => resolve({ status: "superseded" }),
        execute: async () => {
          try {
            const result = await send();
            resolve({ status: "saved", result, latest: isLatest() });
          } catch (error) {
            resolve({ status: "failed", error, latest: isLatest() });
          }
        },
      });
      if (!lane.busy) void drain(lane);
    });
  }

  return { save };
}
