-- Seguimientos cancelados por chat (6-oct-2026, docs/seguimientos.md §15): quién los canceló y cuándo; quedan
-- apagados en ese chat hasta que un vendedor o admin los reactive. Columnas nuevas nulas, sin tocar datos.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "seguimientos_off_at" timestamp;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "seguimientos_off_by_user_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_seguimientos_off_by_user_id_user_id_fk" FOREIGN KEY ("seguimientos_off_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;