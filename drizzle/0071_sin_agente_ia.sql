-- Chat sin Agente IA (26-oct-2026): marca fija del contacto para que el Agente IA lo deje por completo
-- (no contesta, el lector no lo lee, sin seguimientos ni palabras clave). Sin interfaz.
-- docs/agente-ia/2026-10-26-chat-sin-agente-ia.md
ALTER TABLE "contacts" ADD COLUMN "sin_agente_ia" boolean DEFAULT false NOT NULL;