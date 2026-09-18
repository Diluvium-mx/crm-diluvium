import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Solo el alias "@/…" de tsconfig.json, para que los tests puedan importar
// módulos que lo usan (p. ej. lib/messaging/ingest.ts → @/lib/db).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    // Los tests de integración (*.int.test.ts) comparten UNA base de pruebas y
    // la truncan en cada beforeEach; si dos archivos corrieran en paralelo se
    // pisarían. La suite completa tarda <2 s, así que se corren los archivos en
    // serie. Los tests puros no tocan la base y no se ven afectados.
    fileParallelism: false,
  },
});
