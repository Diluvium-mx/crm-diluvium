-- Cobro de Railway (7-oct-2026): última lectura del uso y la factura del workspace de Railway
-- (lib/db/schema/railway-billing.ts). Tabla nueva, sin tocar datos existentes.
CREATE TABLE "railway_billing" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"plan" text,
	"state" text,
	"period_start" timestamp,
	"period_end" timestamp,
	"usage_usd" numeric(14, 6),
	"next_invoice_usd" numeric(14, 6),
	"next_invoice_at" timestamp,
	"fetched_at" timestamp,
	"attempted_at" timestamp NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "railway_billing" ADD CONSTRAINT "railway_billing_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;