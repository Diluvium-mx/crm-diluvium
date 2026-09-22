-- lock_timeout: drizzle corre todas las migraciones en UNA transacción; si un
-- ALTER no consigue su lock en 5 s, falla (y se reintenta) en vez de bloquear el
-- tráfico. Se restablece al final para no afectar a las migraciones siguientes.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TYPE "public"."scheduled_message_kind" AS ENUM('text', 'template');--> statement-breakpoint
CREATE TYPE "public"."scheduled_message_status" AS ENUM('scheduled', 'sending', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "scheduled_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"kind" "scheduled_message_kind" NOT NULL,
	"body" text NOT NULL,
	"template_id" text,
	"template_params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"send_at" timestamp NOT NULL,
	"programmed_at" timestamp DEFAULT now() NOT NULL,
	"cancel_if_inbound" boolean DEFAULT true NOT NULL,
	"status" "scheduled_message_status" DEFAULT 'scheduled' NOT NULL,
	"cancel_reason" text,
	"error_code" text,
	"error_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"message_id" text,
	"dismissed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_messages_conversation_idx" ON "scheduled_messages" USING btree ("organization_id","conversation_id","status");--> statement-breakpoint
CREATE INDEX "scheduled_messages_due_idx" ON "scheduled_messages" USING btree ("status","send_at") WHERE "scheduled_messages"."status" in ('scheduled', 'sending');
--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
