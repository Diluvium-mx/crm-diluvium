ALTER TABLE "contacts" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "country" text;