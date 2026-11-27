CREATE TABLE "ai_plan_credits" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"monthly_usd" numeric(12, 2) NOT NULL,
	"renews_day" integer NOT NULL,
	"starts_on" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_plan_credits" ADD CONSTRAINT "ai_plan_credits_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_plan_credits_org_provider_idx" ON "ai_plan_credits" USING btree ("organization_id","provider");