-- Gasto de IA real (1-oct-2026): última lectura de los reportes de cobro de cada proveedor
-- (lib/db/schema/ai-billing.ts). Tabla nueva, sin tocar datos existentes.
CREATE TABLE "ai_provider_billing" (
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"days" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"balance_usd" numeric(14, 6),
	"loaded_usd" numeric(14, 6),
	"fetched_at" timestamp,
	"attempted_at" timestamp NOT NULL,
	"last_error" text,
	CONSTRAINT "ai_provider_billing_organization_id_provider_pk" PRIMARY KEY("organization_id","provider")
);
--> statement-breakpoint
ALTER TABLE "ai_provider_billing" ADD CONSTRAINT "ai_provider_billing_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;