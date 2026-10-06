-- Embudo: «Quitar tarjeta» del clic derecho (6-oct-2026). Hora hasta la que los avisos del
-- Agente IA ya no pintan de amarillo la tarjeta (solo presentación; el aviso no se resuelve).
-- Columna nula sin default: solo cambia el catálogo, no reescribe ninguna fila. El
-- lock_timeout evita bloquear los webhooks si no consigue el lock en 5 s (falla y el
-- pre-deploy se reintenta). IDEMPOTENTE (IF NOT EXISTS), igual que la 0045.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "urgent_cleared_at" timestamp;--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
