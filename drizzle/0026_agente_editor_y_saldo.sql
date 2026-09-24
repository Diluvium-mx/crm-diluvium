CREATE TABLE "ai_knowledge_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_credit_topups" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"amount_usd" numeric(12, 2) NOT NULL,
	"topped_up_on" date NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN "agent_name" text DEFAULT 'Ángela' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN "company_name" text;--> statement-breakpoint
ALTER TABLE "ai_knowledge_versions" ADD CONSTRAINT "ai_knowledge_versions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_knowledge_versions" ADD CONSTRAINT "ai_knowledge_versions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_credit_topups" ADD CONSTRAINT "ai_credit_topups_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_credit_topups" ADD CONSTRAINT "ai_credit_topups_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_knowledge_versions_org_kind_idx" ON "ai_knowledge_versions" USING btree ("organization_id","kind","created_at" desc);--> statement-breakpoint
CREATE INDEX "ai_credit_topups_org_provider_idx" ON "ai_credit_topups" USING btree ("organization_id","provider","topped_up_on" desc);