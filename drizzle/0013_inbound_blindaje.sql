DROP INDEX "conversations_org_last_message_idx";--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "last_message_at" SET DEFAULT now();--> statement-breakpoint
-- Relleno antes del NOT NULL: una conversación sin last_message_at toma la hora
-- de su último mensaje o, si no tiene, la de su creación.
UPDATE "conversations" c SET "last_message_at" = coalesce(
  (SELECT max(coalesce(m."sent_at", m."created_at")) FROM "messages" m WHERE m."conversation_id" = c."id"),
  c."created_at"
) WHERE c."last_message_at" IS NULL;--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "last_message_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "phone_country_code" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "phone_national" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "phone_country_iso" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "wa_bsuid" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "reactions" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "edited_at" timestamp;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "dead_lettered_at" timestamp;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "quarantined_at" timestamp;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "orphan_wamid" text;--> statement-breakpoint
CREATE INDEX "contacts_org_phone_idx" ON "contacts" USING btree ("organization_id","phone_e164");--> statement-breakpoint
CREATE INDEX "contacts_org_phone_national_idx" ON "contacts" USING btree ("organization_id","phone_national" text_pattern_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_org_wa_bsuid_uidx" ON "contacts" USING btree ("organization_id","wa_bsuid") WHERE "contacts"."wa_bsuid" is not null;--> statement-breakpoint
CREATE INDEX "webhook_events_quarantine_idx" ON "webhook_events" USING btree ("quarantined_at") WHERE "webhook_events"."quarantined_at" is not null;--> statement-breakpoint
CREATE INDEX "webhook_events_orphan_wamid_idx" ON "webhook_events" USING btree ("orphan_wamid") WHERE "webhook_events"."orphan_wamid" is not null;--> statement-breakpoint
CREATE INDEX "webhook_events_dead_letter_idx" ON "webhook_events" USING btree ("dead_lettered_at") WHERE "webhook_events"."dead_lettered_at" is not null;--> statement-breakpoint
CREATE INDEX "conversations_org_last_message_idx" ON "conversations" USING btree ("organization_id","last_message_at" desc,"id" desc);--> statement-breakpoint
-- Estados (entregado/leído/falló) de mensajes que el CRM nunca tuvo: ahora se
-- cierran tras 10 min como huérfanos reabribles (ingest.ts). Se liberan los que
-- quedaron atorados en dead-letter con la regla vieja para que el barrido los cierre.
UPDATE "webhook_events" SET "attempts" = 0
WHERE "processed_at" IS NULL
  AND "event" IN ('message.delivered', 'message.read', 'message.failed')
  AND "last_error" = 'mensaje del estado aún no existe';--> statement-breakpoint
-- El resto de dead-letters existentes quedan registrados como tales.
UPDATE "webhook_events" SET "dead_lettered_at" = now()
WHERE "processed_at" IS NULL AND "attempts" >= 20;
