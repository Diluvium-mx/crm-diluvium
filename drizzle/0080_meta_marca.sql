-- Marca de Meta y cobro de Meta (docs/meta-whatsapp.md). Idempotente: en staging ya se aplicó como 0078 (4-nov-2026)
-- y se renumeró a 0080 porque la 0079 entró antes a main (drizzle salta en silencio un `when` menor).
CREATE TABLE IF NOT EXISTS "meta_whatsapp_pricing" (
	"organization_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"day" date NOT NULL,
	"category" text NOT NULL,
	"pricing_type" text NOT NULL,
	"volume" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(14, 6),
	"fetched_at" timestamp NOT NULL,
	CONSTRAINT "meta_whatsapp_pricing_pk" PRIMARY KEY("organization_id","channel_id","day","category","pricing_type")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meta_whatsapp_pricing_sync" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"fetched_at" timestamp,
	"attempted_at" timestamp NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "meta_billable" boolean;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "meta_category" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "meta_pricing_type" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "meta_window_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "meta_window_origin" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "meta_whatsapp_pricing" ADD CONSTRAINT "meta_whatsapp_pricing_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "meta_whatsapp_pricing" ADD CONSTRAINT "meta_whatsapp_pricing_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "meta_whatsapp_pricing_sync" ADD CONSTRAINT "meta_whatsapp_pricing_sync_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_meta_mark_idx" ON "messages" USING btree ("organization_id","created_at") WHERE "messages"."meta_category" is not null;
