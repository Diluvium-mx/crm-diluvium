-- "Ver cambios" del Historial (Bloque E, 28-sep-2026): el antes/después COMPLETO de un cambio
-- (workflows paso por paso, regla de etapa, nombre del agente, mensajes rápidos, plantillas,
-- tallas) para resaltar lo quitado y lo agregado (lib/historial/diff.ts). Columna NUEVA y nula:
-- no reescribe la tabla ni toca ninguna fila (las de antes quedan en null = sin "Ver cambios").
-- IDEMPOTENTE (IF NOT EXISTS), igual que la 0042.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "change_history" ADD COLUMN IF NOT EXISTS "detail" jsonb;--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
