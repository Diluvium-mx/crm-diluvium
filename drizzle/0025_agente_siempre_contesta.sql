CREATE TABLE "ai_agent_notices" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"message_id" text,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_config" ALTER COLUMN "anti_loop_max_per_hour" SET DEFAULT 30;--> statement-breakpoint
ALTER TABLE "ai_agent_notices" ADD CONSTRAINT "ai_agent_notices_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_notices" ADD CONSTRAINT "ai_agent_notices_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_notices" ADD CONSTRAINT "ai_agent_notices_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_agent_notices_conversation_created_idx" ON "ai_agent_notices" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_notices_message_kind_uidx" ON "ai_agent_notices" USING btree ("message_id","kind") WHERE "ai_agent_notices"."message_id" is not null;--> statement-breakpoint
-- Desde el 23-sep-2026 el agente no tiene modo "borrador": un canal en borrador queda APAGADO (nunca pasa solo a AUTO).
UPDATE "channels" SET "ai_agent_mode" = 'off', "ai_agent_mode_changed_at" = now() WHERE "ai_agent_mode" = 'borrador';--> statement-breakpoint
-- Los borradores vigentes se descartan: ya no hay tarjeta para enviarlos.
UPDATE "ai_agent_drafts" SET "status" = 'descartado', "resolved_at" = now() WHERE "status" = 'pendiente';--> statement-breakpoint
-- Solo la respuesta de un vendedor pausa al agente: se levantan las pausas de la guardia, del pase a humano y del
-- anti-bucle. El corte es ahora: no contesta lo que el cliente escribió durante la pausa.
UPDATE "conversations" SET "agent_state" = 'activo', "agent_paused_until" = NULL, "agent_state_changed_at" = now() WHERE "agent_state" IN ('pausado_handover', 'pausado_antibucle');--> statement-breakpoint
-- Anti-bucle solo para un bucle real con otro bot.
UPDATE "ai_config" SET "anti_loop_max_per_hour" = 30 WHERE "anti_loop_max_per_hour" < 30;
