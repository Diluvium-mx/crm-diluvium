-- Chat sin Agente IA (26-oct-2026): «Mostrador Paquetexpress», desde donde se piden las recolecciones a
-- Paquete Express. Misma marca que la 0071 (docs/agente-ia/2026-10-26-chat-sin-agente-ia.md), por id (el
-- teléfono no va al repo, que es público). Leído en producción el 26-oct-2026 con su OK: UN solo contacto
-- con ese número y 1 chat. En staging y en las bases locales no existe: no cambia nada.
UPDATE "contacts" SET "sin_agente_ia" = true
WHERE "id" = '74f1580f-eddf-4833-ba12-7493c5323170' AND "organization_id" = 'dCaM2U7AxsM1g5e6o5Yr6ILDmmFH71IR';
