ALTER TABLE "contacts" ADD COLUMN "stage_changed_by" text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "trigger_message_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_agent_msg_uidx" ON "workflow_runs" USING btree ("organization_id","workflow_id","trigger_message_id") WHERE "workflow_runs"."trigger_message_id" is not null and "workflow_runs"."trigger" = 'agent';--> statement-breakpoint
CREATE TYPE "public"."comprobante_tipo" AS ENUM('total', 'anticipo', 'resto');--> statement-breakpoint
CREATE TABLE "comprobantes" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text,
	"conversation_id" text,
	"message_id" text,
	"monto" text,
	"referencia" text,
	"referencia_norm" text,
	"banco" text,
	"fecha_comprobante" text,
	"tipo" "comprobante_tipo",
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comprobantes_org_ref_idx" ON "comprobantes" USING btree ("organization_id","referencia_norm");--> statement-breakpoint
CREATE INDEX "comprobantes_contact_idx" ON "comprobantes" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "comprobantes_message_uidx" ON "comprobantes" USING btree ("message_id");--> statement-breakpoint
-- Historial: las referencias ya confirmadas pasan al registro mínimo (el chequeo
-- de referencia repetida no arranca ciego). Producción tenía 0 filas el 24-sep.
INSERT INTO "comprobantes" (id, organization_id, contact_id, conversation_id, message_id, monto, referencia, referencia_norm, banco, fecha_comprobante, tipo, created_at)
SELECT id, organization_id, contact_id, conversation_id, NULL, '$' || to_char(monto_mxn, 'FM999,999,990.00'), referencia,
       upper(regexp_replace(referencia, '[^A-Za-z0-9]', '', 'g')), banco, fecha_comprobante,
       (CASE tipo::text WHEN 'completo' THEN 'total' WHEN 'liquidacion' THEN 'resto' ELSE 'anticipo' END)::"comprobante_tipo", created_at
FROM "pagos_confirmados";--> statement-breakpoint
DROP TABLE "pagos_confirmados" CASCADE;--> statement-breakpoint
DROP TYPE "public"."pago_tipo";
--> statement-breakpoint
-- Datos (Fase D reestructurada, 24-sep-2026): los workflows de cobro, humano y etapa
-- desaparecen (sus pasos y corridas caen en cascada; los mensajes y avisos ya
-- mostrados en la Bandeja no se tocan) y los pasos que dejaron de existir se quitan
-- de los workflows de media (datos_bancarios pierde su set_stage: ahora es regla del CRM).
DELETE FROM "workflows" WHERE "slug" IN ('transferir_humano', 'cambiar_etapa', 'pago_confirmado', 'anticipo_confirmado', 'pago_no_cuadra');--> statement-breakpoint
DELETE FROM "workflow_steps" WHERE "kind" IN ('set_stage', 'handover', 'add_tag', 'internal_note');--> statement-breakpoint
WITH n AS (SELECT id, row_number() OVER (PARTITION BY workflow_id ORDER BY position) - 1 AS pos FROM "workflow_steps")
UPDATE "workflow_steps" s SET position = n.pos FROM n WHERE n.id = s.id AND s.position <> n.pos;--> statement-breakpoint
-- Un workflow personalizado que solo tenía pasos de etapa/etiqueta/aviso queda sin pasos: se apaga.
UPDATE "workflows" w SET enabled = false WHERE NOT EXISTS (SELECT 1 FROM "workflow_steps" s WHERE s.workflow_id = w.id);
