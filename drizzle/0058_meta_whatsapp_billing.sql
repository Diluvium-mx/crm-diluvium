-- Cobro de Meta por WhatsApp (5-oct-2026): última lectura del reporte pricing_analytics de la WABA
-- (lib/db/schema/meta-billing.ts). Tabla nueva, sin tocar datos existentes.
CREATE TABLE "meta_whatsapp_billing" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"waba_id" text NOT NULL,
	"currency" text,
	"days" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fetched_at" timestamp,
	"attempted_at" timestamp NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "meta_whatsapp_billing" ADD CONSTRAINT "meta_whatsapp_billing_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;