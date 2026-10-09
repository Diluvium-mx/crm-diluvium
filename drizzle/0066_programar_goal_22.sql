CREATE TABLE "ai_scheduled_changes" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"goal" text,
	"base_goal" text,
	"faqs" jsonb,
	"base_faqs" jsonb,
	"apply_at" timestamp NOT NULL,
	"status" text DEFAULT 'programado' NOT NULL,
	"conflict" text,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_scheduled_changes" ADD CONSTRAINT "ai_scheduled_changes_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_scheduled_changes" ADD CONSTRAINT "ai_scheduled_changes_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_scheduled_changes" ADD CONSTRAINT "ai_scheduled_changes_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;