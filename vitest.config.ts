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
    // Los tests de integración (*.int.test.ts) comparten UNA base de pruebas y
    // la truncan en cada beforeEach; si dos archivos corrieran en paralelo se
    // pisarían. La suite completa tarda <2 s, así que se corren los archivos en
    // serie. Los tests puros no tocan la base y no se ven afectados.
    fileParallelism: false,
  },
});
