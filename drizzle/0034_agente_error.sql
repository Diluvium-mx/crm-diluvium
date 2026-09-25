ALTER TABLE "ai_agent_notices" ADD COLUMN "resolved_at" timestamp;--> statement-breakpoint
ALTER TABLE "ai_agent_notices" ADD COLUMN "resolution" text;--> statement-breakpoint
ALTER TABLE "ai_agent_notices" ADD COLUMN "resolved_by_user_id" text;--> statement-breakpoint
ALTER TABLE "ai_agent_notices" ADD CONSTRAINT "ai_agent_notices_resolved_by_user_id_user_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;