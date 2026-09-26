// Punto de reanudación del importador del historial (scripts/importar-historial.ts).
// Guarda SOLO ids de conversaciones de Zernio y conteos (nada de mensajes ni teléfonos):
// si la corrida se corta (Ctrl+C, red, límite de Zernio), la siguiente salta los chats
// ya terminados. El chat que quedó a medias se repite completo y el wamid único evita
// duplicados. Escritura atómica (archivo temporal + rename): un corte a la mitad de
// guardar no deja un JSON roto.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type HistoryImportState = {
  version: 1;
  accountId: string;
  startedAt: string;
  updatedAt: string;
  /** La corrida llegó al final: la próxima empieza desde cero (segunda pasada completa). */
  finished: boolean;
  /** Conversaciones de Zernio ya recorridas completas. */
  done: string[];
};

export type HistoryStateStore = {
  load(): Promise<HistoryImportState | null>;
  save(state: HistoryImportState): Promise<void>;
};

export function fileStateStore(path: string): HistoryStateStore {
  return {
    async load() {
      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
      const parsed = JSON.parse(text) as HistoryImportState;
      if (parsed.version !== 1 || !Array.isArray(parsed.done)) throw new Error(`Estado del importador no reconocido: ${path}`);
      return parsed;
    },
    async save(state) {
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      await writeFile(tmp, JSON.stringify(state));
      await rename(tmp, path);
    },
  };
}

export function memoryStateStore(initial: HistoryImportState | null = null): HistoryStateStore & { current: HistoryImportState | null } {
  const store = {
    current: initial,
    async load() {
      return store.current ? structuredClone(store.current) : null;
    },
    async save(state: HistoryImportState) {
      store.current = structuredClone(state);
    },
  };
  return store;
}
