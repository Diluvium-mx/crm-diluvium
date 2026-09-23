-- Fase B (Agente IA): uso y costo por llamada al modelo (ai_usage), precios
-- editables por organización (ai_model_prices), borradores del modo "borrador"
-- (ai_agent_drafts), corte de "respuesta humana" (conversations.agent_state_changed_at)
-- y ajustes del runtime en ai_config. Aditiva: el agente sigue APAGADO por canal.
-- lock_timeout: drizzle corre todas las migraciones en UNA transacción; si un
-- ALTER no consigue su lock en 5 s, falla (y se reintenta) en vez de bloquear el
-- tráfico. Se restablece al final para no afectar a las migraciones siguientes.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TYPE "public"."ai_draft_status" AS ENUM('pendiente', 'enviado', 'descartado', 'obsoleto');--> statement-breakpoint
CREATE TYPE "public"."ai_usage_stage" AS ENUM('filtro', 'cerebro');--> statement-breakpoint
CREATE TABLE "ai_agent_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"bubbles" jsonb NOT NULL,
	"trigger_message_id" text,
	"status" "ai_draft_status" DEFAULT 'pendiente' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"resolved_by_user_id" text
);
--> statement-breakpoint
CREATE TABLE "ai_model_prices" (
	"organization_id" text NOT NULL,
	"model_id" text NOT NULL,
	"input_per_mtok" numeric(12, 6) NOT NULL,
	"output_per_mtok" numeric(12, 6) NOT NULL,
	"cache_read_per_mtok" numeric(12, 6),
	"cache_write_per_mtok" numeric(12, 6),
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by_user_id" text,
	CONSTRAINT "ai_model_prices_organization_id_model_id_pk" PRIMARY KEY("organization_id","model_id")
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text,
	"message_id" text,
	"stage" "ai_usage_stage" NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_read_tokens" integer,
	"cache_write_tokens" integer,
	"latency_ms" integer NOT NULL,
	"cost_usd" numeric(14, 8),
	"filter_decision" text,
	"outcome" text,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "agent_state_changed_at" timestamp;--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN "pause_on_human_reply" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN "context_messages" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN "max_bubbles" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agent_drafts" ADD CONSTRAINT "ai_agent_drafts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_drafts" ADD CONSTRAINT "ai_agent_drafts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_drafts" ADD CONSTRAINT "ai_agent_drafts_trigger_message_id_messages_id_fk" FOREIGN KEY ("trigger_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_drafts" ADD CONSTRAINT "ai_agent_drafts_resolved_by_user_id_user_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model_prices" ADD CONSTRAINT "ai_model_prices_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model_prices" ADD CONSTRAINT "ai_model_prices_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_drafts_one_pending_uidx" ON "ai_agent_drafts" USING btree ("conversation_id") WHERE "ai_agent_drafts"."status" = 'pendiente';--> statement-breakpoint
CREATE INDEX "ai_agent_drafts_org_idx" ON "ai_agent_drafts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ai_usage_org_created_idx" ON "ai_usage" USING btree ("organization_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "ai_usage_conversation_created_idx" ON "ai_usage" USING btree ("conversation_id","created_at");--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
