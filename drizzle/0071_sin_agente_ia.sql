-- Chat sin Agente IA (26-oct-2026): marca fija del contacto para que el Agente IA lo deje por completo
-- (no contesta, el lector no lo lee, sin seguimientos ni palabras clave). Sin interfaz.
-- docs/agente-ia/2026-10-26-chat-sin-agente-ia.md
ALTER TABLE "contacts" ADD COLUMN "sin_agente_ia" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- El chat propio del dueño, por id (el teléfono no va al repo, que es público). Leído en producción el
-- 26-oct-2026 con su OK: UN solo contacto con ese número y 1 chat. En staging y en las bases locales no
-- existe: no cambia nada.
UPDATE "contacts" SET "sin_agente_ia" = true
WHERE "id" = 'd3bc6189-89c8-4739-b29d-06d9b4b909c6' AND "organization_id" = 'dCaM2U7AxsM1g5e6o5Yr6ILDmmFH71IR';