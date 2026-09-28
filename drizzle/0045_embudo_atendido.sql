-- Embudo: «Marcar como leído» apaga el azul de la tarjeta (28-sep-2026). Hora hasta la que
-- el vendedor dio por atendido lo que escribió el cliente sin contestarle (un "gracias").
-- Columna nula sin default: solo cambia el catálogo, no reescribe ninguna fila. El
-- lock_timeout evita bloquear los webhooks si no consigue el lock en 5 s (falla y el
-- pre-deploy se reintenta). IDEMPOTENTE (IF NOT EXISTS), igual que la 0042–0044.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "attended_at" timestamp;--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
