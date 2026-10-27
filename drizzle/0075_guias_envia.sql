-- Guías de envío con Envia.com desde el Detalle del contacto (27-oct-2026, docs/envios.md): una fila por intento
-- de guía; `request_key` único evita generar (y cobrar) dos guías por un doble clic.
CREATE TABLE "shipments" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"request_key" text NOT NULL,
	"status" text DEFAULT 'generando' NOT NULL,
	"environment" text NOT NULL,
	"carrier" text NOT NULL,
	"service" text NOT NULL,
	"service_label" text,
	"tracking_number" text,
	"track_url" text,
	"envia_shipment_id" text,
	"price" numeric(12, 2),
	"currency" text,
	"label_url" text,
	"label_key" text,
	"print_key" text,
	"destination" jsonb NOT NULL,
	"packages" jsonb NOT NULL,
	"insured" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"canceled_at" timestamp,
	"canceled_by_user_id" text,
	CONSTRAINT "shipments_status_check" CHECK ("shipments"."status" in ('generando', 'creada', 'fallida', 'cancelada')),
	CONSTRAINT "shipments_environment_check" CHECK ("shipments"."environment" in ('sandbox', 'production'))
);
--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_canceled_by_user_id_user_id_fk" FOREIGN KEY ("canceled_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_org_request_key_uidx" ON "shipments" USING btree ("organization_id","request_key");--> statement-breakpoint
CREATE INDEX "shipments_org_contact_created_idx" ON "shipments" USING btree ("organization_id","contact_id","created_at");