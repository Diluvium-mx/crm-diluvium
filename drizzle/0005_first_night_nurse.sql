ALTER TABLE "contacts" ADD COLUMN "stage_changed_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
-- Backfill: preservar el orden histórico (created_at) en las filas existentes
-- en vez de dejarlas todas empatadas en la hora del deploy.
UPDATE "contacts" SET "stage_changed_at" = "created_at";