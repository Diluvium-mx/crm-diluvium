import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Solo el alias "@/…" de tsconfig.json, para que los tests puedan importar
// módulos que lo usan (p. ej. lib/messaging/ingest.ts → @/lib/db).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
});
