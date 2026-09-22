import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Solo el alias "@/…" de tsconfig.json, para que los tests puedan importar
// módulos que lo usan (p. ej. lib/messaging/ingest.ts → @/lib/db).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // `server-only` es un guard de build de Next sin runtime; en Vitest se
      // sustituye por un módulo vacío para poder importar módulos de servidor.
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    // Pool `threads` (no el `forks` por defecto): forks escribe un dir temporal
    // `ssr` en $TMPDIR vía tinypool, y el sandbox read-only de la revisión de
    // Codex deniega esa escritura → EPERM y la suite reporta "0 tests" (falso
    // verde que dejaría pasar el gate sin correr ninguna prueba). Con `threads`
    // corre en hilos sin ese temp y pasa bajo read-only (verificado: 206 tests).
    pool: "threads",
    // Los tests de integración (*.int.test.ts) comparten UNA base de pruebas y
    // la truncan en cada beforeEach; si dos archivos corrieran en paralelo se
    // pisarían. La suite completa tarda <2 s, así que se corren los archivos en
    // serie. Los tests puros no tocan la base y no se ven afectados.
    fileParallelism: false,
  },
});
