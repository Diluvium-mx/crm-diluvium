-- Lector en segundo plano (28-sep-2026, decisión del dueño): el Agente IA deja al día la etapa y el
-- Detalle del contacto SIEMPRE, aunque esté apagado o pausado en el chat (lib/ai/runtime/lector.ts).
-- 1) ai_usage.stage 'detalle': su gasto va aparte de las respuestas. ADD VALUE dentro de la
--    transacción es válido (PG ≥ 12) mientras nada lo use en la misma (igual que la 0037).
-- 2) contacts.pago_total: lo que el cliente ya pagó; el monto de cotización queda como el total de
--    lo que el cliente eligió al final.
-- 3) conversations.detalle_leido_hasta: hasta qué last_message_at ya leyó el lector. Lo que ya
--    existía se marca leído (el barrido solo toma actividad nueva); la pasada única sobre los chats
--    que eligió el dueño la hace scripts/lector-detalle.ts.
-- IDEMPOTENTE (IF NOT EXISTS) y con lock_timeout, igual que la 0044.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TYPE "public"."ai_usage_stage" ADD VALUE IF NOT EXISTS 'detalle';--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "pago_total" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "detalle_leido_hasta" timestamp;--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT IF EXISTS "contacts_pago_total_check";--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_pago_total_check" CHECK ("contacts"."pago_total" is null or "contacts"."pago_total" >= 0);--> statement-breakpoint
UPDATE "conversations" SET "detalle_leido_hasta" = "last_message_at" WHERE "detalle_leido_hasta" IS NULL;--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
