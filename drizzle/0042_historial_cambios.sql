-- Historial de cambios (Bloque A, 28-sep-2026; subpestaña "Historial" de la pestaña Agente IA).
-- Tabla NUEVA, append-only: no toca ninguna fila existente. IDEMPOTENTE (IF [NOT] EXISTS),
-- igual que la 0035–0038. Se escribe en la misma transacción que cada cambio (modelos,
-- etapas, canal, workflows, pausas por chat); Opciones y Goal/FAQs ya tenían su registro.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "change_history" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"kind" text NOT NULL,
	"action" text NOT NULL,
	"subject" text,
	"subject_id" text,
	"old_value" text,
	"new_value" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "change_history" ADD CONSTRAINT "change_history_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "change_history" ADD CONSTRAINT "change_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_history_org_created_idx" ON "change_history" USING btree ("organization_id","created_at");--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
