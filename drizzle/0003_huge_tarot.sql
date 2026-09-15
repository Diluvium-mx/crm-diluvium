DROP INDEX "contacts_org_phone_uidx";--> statement-breakpoint
ALTER TABLE "contacts" ALTER COLUMN "phone_e164" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" RENAME COLUMN "name" TO "first_name";--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "source_channel" text;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_org_ghl_contact_id_uidx" ON "contacts" USING btree ("organization_id","ghl_contact_id") WHERE "contacts"."ghl_contact_id" is not null;