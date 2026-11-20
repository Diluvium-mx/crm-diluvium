CREATE TABLE "crm_cost_months" (
	"organization_id" text NOT NULL,
	"month" text NOT NULL,
	"ia_usd" numeric(14, 6),
	"meta_usd" numeric(14, 6),
	"railway_usd" numeric(14, 6),
	"zernio_usd" numeric(14, 6),
	"source" text DEFAULT 'auto' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "crm_cost_months_organization_id_month_pk" PRIMARY KEY("organization_id","month")
);
--> statement-breakpoint
ALTER TABLE "crm_cost_months" ADD CONSTRAINT "crm_cost_months_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;