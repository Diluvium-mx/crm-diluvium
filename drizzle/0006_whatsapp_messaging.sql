CREATE TYPE "public"."channel_type" AS ENUM('whatsapp');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('open', 'pending', 'closed');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."message_source" AS ENUM('contact', 'crm', 'business_app', 'other_api');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'sent', 'delivered', 'read', 'failed', 'received');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contact', 'template', 'interactive', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."messaging_provider" AS ENUM('zernio', 'meta_cloud');--> statement-breakpoint
CREATE TABLE "channels" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"type" "channel_type" NOT NULL,
	"provider" "messaging_provider" NOT NULL,
	"provider_account_id" text NOT NULL,
	"display_name" text NOT NULL,
	"phone_e164" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"provider_conversation_id" text,
	"assignee_user_id" text,
	"status" "conversation_status" DEFAULT 'open' NOT NULL,
	"last_message_at" timestamp,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"window_expires_at" timestamp,
	"first_response_seconds" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"opportunity_id" text,
	"direction" "message_direction" NOT NULL,
	"source" "message_source" NOT NULL,
	"type" "message_type" NOT NULL,
	"body" text,
	"media_url" text,
	"media_mime_type" text,
	"template_name" text,
	"provider_message_id" text,
	"provider_internal_id" text,
	"status" "message_status" NOT NULL,
	"error_code" text,
	"error_message" text,
	"sent_by_user_id" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "messages_provider_message_id_unique" UNIQUE("provider_message_id")
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"name" text NOT NULL,
	"language" text NOT NULL,
	"category" text,
	"body" text,
	"status" text NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider_template_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" "messaging_provider" NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assignee_user_id_user_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sent_by_user_id_user_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channels_org_idx" ON "channels" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_provider_account_uidx" ON "channels" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_channel_contact_uidx" ON "conversations" USING btree ("channel_id","contact_id");--> statement-breakpoint
CREATE INDEX "conversations_org_last_message_idx" ON "conversations" USING btree ("organization_id","last_message_at" desc nulls last);--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_channel_provider_conv_uidx" ON "conversations" USING btree ("channel_id","provider_conversation_id") WHERE "conversations"."provider_conversation_id" is not null;--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "messages_org_idx" ON "messages" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_org_provider_internal_uidx" ON "messages" USING btree ("organization_id","provider_internal_id") WHERE "messages"."provider_internal_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "templates_channel_name_lang_uidx" ON "templates" USING btree ("channel_id","name","language");--> statement-breakpoint
CREATE INDEX "webhook_events_pending_idx" ON "webhook_events" USING btree ("received_at") WHERE "webhook_events"."processed_at" is null;