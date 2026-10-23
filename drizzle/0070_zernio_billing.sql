-- Cobro de Zernio (23-oct-2026): última lectura del consumo del mes y del estado del cobro de Zernio
-- (lib/db/schema/zernio-billing.ts). Tabla nueva, sin tocar datos existentes.
CREATE TABLE "zernio_billing" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"period_start" timestamp,
	"period_end" timestamp,
	"total_usd" numeric(14, 6),
	"messages_usd" numeric(14, 6),
	"accounts_usd" numeric(14, 6),
	"prev_total_usd" numeric(14, 6),
	"prev_period_start" timestamp,
	"suspended" boolean DEFAULT false NOT NULL,
	"decline_reason" text,
	"open_invoice" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp,
	"attempted_at" timestamp NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "zernio_billing" ADD CONSTRAINT "zernio_billing_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;