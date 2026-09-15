CREATE TYPE "public"."contact_stage" AS ENUM('inbox', 'prospecto', 'interesado', 'cerca_compra', 'compra');--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"phone_e164" text NOT NULL,
	"email" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ghl_contact_id" text,
	"source" text,
	"stage" "contact_stage" DEFAULT 'inbox' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_org_idx" ON "contacts" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_org_phone_uidx" ON "contacts" USING btree ("organization_id","phone_e164");