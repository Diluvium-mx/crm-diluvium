-- Anuncios de Meta (clic a WhatsApp): atribución (ad_clicks), caché de Meta y
-- UNA miniatura por anuncio (meta_ads), y la entrada por anuncio de la conversación.
-- IDEMPOTENTE a propósito: staging ya tenía estas tablas de la 0028_anuncios_meta
-- vieja (24-sep-2026, retirada al renumerar a 0030). En producción crea todo; en
-- staging solo agrega lo que falta. Las columnas viejas de staging (media,
-- creative_media) se dejan (no se borra nada); el código ya no las usa.
CREATE TABLE IF NOT EXISTS "ad_clicks" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"message_id" text,
	"origin" text NOT NULL,
	"platform" text DEFAULT 'whatsapp' NOT NULL,
	"ad_id" text,
	"source_type" text,
	"source_url" text,
	"headline" text,
	"body" text,
	"media_type" text,
	"ctwa_clid" text,
	"welcome_message" text,
	"raw" jsonb NOT NULL,
	"clicked_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meta_ads" (
	"organization_id" text NOT NULL,
	"ad_id" text NOT NULL,
	"ad_name" text,
	"adset_id" text,
	"adset_name" text,
	"campaign_id" text,
	"campaign_name" text,
	"account_id" text,
	"effective_status" text,
	"creative_id" text,
	"creative_title" text,
	"creative_body" text,
	"creative_object_type" text,
	"cta_type" text,
	"link_url" text,
	"video_id" text,
	"video_title" text,
	"video_length_seconds" double precision,
	"story_id" text,
	"ads_manager_url" text,
	"post_url" text,
	"meta_raw" jsonb,
	"thumbnail_key" text,
	"thumbnail_url" text,
	"thumbnail_attempts" integer DEFAULT 0 NOT NULL,
	"thumbnail_error" text,
	"thumbnail_stored_at" timestamp,
	"fetched_at" timestamp,
	"fetch_error" text,
	"fetch_attempts" integer DEFAULT 0 NOT NULL,
	"next_fetch_at" timestamp,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "meta_ads_organization_id_ad_id_pk" PRIMARY KEY("organization_id","ad_id")
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "ad_entry_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_clicks_organization_id_organization_id_fk') THEN
    ALTER TABLE "ad_clicks" ADD CONSTRAINT "ad_clicks_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_clicks_contact_id_contacts_id_fk') THEN
    ALTER TABLE "ad_clicks" ADD CONSTRAINT "ad_clicks_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_clicks_conversation_id_conversations_id_fk') THEN
    ALTER TABLE "ad_clicks" ADD CONSTRAINT "ad_clicks_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_clicks_message_id_messages_id_fk') THEN
    ALTER TABLE "ad_clicks" ADD CONSTRAINT "ad_clicks_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_ads_organization_id_organization_id_fk') THEN
    ALTER TABLE "meta_ads" ADD CONSTRAINT "meta_ads_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ad_clicks_message_uidx" ON "ad_clicks" USING btree ("message_id") WHERE "ad_clicks"."message_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ad_clicks_org_clid_uidx" ON "ad_clicks" USING btree ("organization_id","ctwa_clid") WHERE "ad_clicks"."ctwa_clid" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_clicks_org_ad_idx" ON "ad_clicks" USING btree ("organization_id","ad_id","clicked_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_clicks_contact_idx" ON "ad_clicks" USING btree ("contact_id","clicked_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_clicks_conversation_idx" ON "ad_clicks" USING btree ("conversation_id","clicked_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meta_ads_next_fetch_idx" ON "meta_ads" USING btree ("next_fetch_at");
--> statement-breakpoint
ALTER TABLE "meta_ads" ADD COLUMN IF NOT EXISTS "cta_type" text;
--> statement-breakpoint
ALTER TABLE "meta_ads" ADD COLUMN IF NOT EXISTS "link_url" text;
--> statement-breakpoint
ALTER TABLE "meta_ads" ADD COLUMN IF NOT EXISTS "video_title" text;
--> statement-breakpoint
ALTER TABLE "meta_ads" ADD COLUMN IF NOT EXISTS "video_length_seconds" double precision;
--> statement-breakpoint
ALTER TABLE "meta_ads" ADD COLUMN IF NOT EXISTS "ads_manager_url" text;
--> statement-breakpoint
ALTER TABLE "meta_ads" ADD COLUMN IF NOT EXISTS "post_url" text;
--> statement-breakpoint
ALTER TABLE "meta_ads" ADD COLUMN IF NOT EXISTS "meta_raw" jsonb;
--> statement-breakpoint
ALTER TABLE "meta_ads" ADD COLUMN IF NOT EXISTS "thumbnail_key" text;
--> statement-breakpoint
ALTER TABLE "meta_ads" ADD COLUMN IF NOT EXISTS "thumbnail_url" text;
--> statement-breakpoint
ALTER TABLE "meta_ads" ADD COLUMN IF NOT EXISTS "thumbnail_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "meta_ads" ADD COLUMN IF NOT EXISTS "thumbnail_error" text;
--> statement-breakpoint
ALTER TABLE "meta_ads" ADD COLUMN IF NOT EXISTS "thumbnail_stored_at" timestamp;
