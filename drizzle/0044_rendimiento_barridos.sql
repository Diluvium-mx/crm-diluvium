-- Rendimiento de los barridos del worker (revisión completa, F3, 28-sep-2026). Cada minuto
-- varios barridos leen solo los mensajes recientes (anuncios 24 h/7 d, media y miniaturas
-- 30 d, transcripciones, avisos de envíos fallidos del agente, adjuntos pendientes) y hoy
-- recorren `messages` completa. Solo agrega índices: no toca ninguna fila.
-- Tabla chica (≈1,100 filas al crearla): el CREATE INDEX normal tarda milisegundos; drizzle
-- corre en una transacción (CONCURRENTLY no se puede) y el lock_timeout evita bloquear el
-- tráfico si no consigue el lock en 5 s (falla y el pre-deploy se reintenta).
-- IDEMPOTENTE (IF NOT EXISTS), igual que la 0042 y la 0043.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_created_idx" ON "messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_out_queued_idx" ON "messages" USING btree ("created_at") WHERE "messages"."direction" = 'out' and "messages"."status" = 'queued';--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
