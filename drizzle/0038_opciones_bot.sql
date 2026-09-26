-- Opciones del bot (26-sep-2026, sección "Opciones" de la pestaña Agente IA). IDEMPOTENTE
-- (IF [NOT] EXISTS), igual que la 0035–0037. Los valores de fábrica son EXACTAMENTE el
-- comportamiento anterior: ninguna fila cambia de conducta con esta migración.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
-- Quién cambió qué opción y cuándo (append-only; la pestaña muestra el último cambio).
CREATE TABLE IF NOT EXISTS "ai_config_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- 3. "Cuando el cliente pide un asesor": se reusa handover_reactivate_hours (Fase B, sin uso,
-- NOT NULL DEFAULT 8). Pasa a nullable y las filas existentes quedan en NULL = "avisar al
-- vendedor y seguir contestando" (lo que hace hoy). Con horas = avisar y pausar ese tiempo.
ALTER TABLE "ai_config" ALTER COLUMN "handover_reactivate_hours" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ai_config" ALTER COLUMN "handover_reactivate_hours" DROP NOT NULL;--> statement-breakpoint
UPDATE "ai_config" SET "handover_reactivate_hours" = NULL WHERE "handover_reactivate_hours" IS NOT NULL;--> statement-breakpoint
-- 2. Horas tras las que el bot vuelve solo después de que un vendedor contesta (NULL = nunca).
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "human_reply_reactivate_hours" integer;--> statement-breakpoint
-- 4. Horario del bot en hora de Mazatlán (NULL = 24/7).
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "bot_schedule" jsonb;--> statement-breakpoint
-- 5. Leer imágenes y transcribir notas de voz (fábrica sí, como hoy).
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "read_images" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "transcribe_audio" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- 6. Longitud de respuesta (fábrica balanceada = sin línea extra en el system).
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "response_length" text DEFAULT 'balanceada' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_config_changes" ADD CONSTRAINT "ai_config_changes_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_config_changes" ADD CONSTRAINT "ai_config_changes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_config_changes_org_created_idx" ON "ai_config_changes" USING btree ("organization_id","created_at");--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
