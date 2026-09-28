-- Palabra clave durable (revisión completa B1, 28-sep-2026): un mensaje del cliente dispara como
-- máximo UNA corrida por palabra clave, aunque el barrido lo vuelva a evaluar tras un reinicio del
-- worker (lib/workflows/keyword-pending.ts). Las corridas viejas por palabra clave tienen
-- trigger_message_id nulo y quedan fuera del índice: no choca con ninguna fila. Solo agrega un índice.
-- IDEMPOTENTE (IF NOT EXISTS) y con lock_timeout, igual que la 0044.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_runs_keyword_msg_uidx" ON "workflow_runs" USING btree ("organization_id","trigger_message_id") WHERE "workflow_runs"."trigger_message_id" is not null and "workflow_runs"."trigger" = 'keyword';--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
