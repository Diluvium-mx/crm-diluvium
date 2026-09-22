-- Fase B (Agente IA): base de conocimiento + Goal. Traída a main desde
-- feat/agente-ia-runtime con el MISMO `when` del journal (ya aplicada en prod y
-- staging). Idempotente: si por error se re-ejecuta sobre una base que ya la
-- tiene, no falla ni duplica nada.
CREATE TABLE IF NOT EXISTS "ai_knowledge" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"ghl_id" text,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"position" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "goal" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_knowledge" ADD CONSTRAINT "ai_knowledge_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_knowledge_org_idx" ON "ai_knowledge" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_knowledge_org_position_idx" ON "ai_knowledge" USING btree ("organization_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_knowledge_org_ghl_id_uidx" ON "ai_knowledge" USING btree ("organization_id","ghl_id") WHERE "ai_knowledge"."ghl_id" is not null;
