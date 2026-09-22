-- Fase B (Agente IA): interruptor por canal, estado del agente por conversación
-- y parámetros de seguridad. Traída a main desde feat/agente-ia-runtime con el
-- MISMO `when` del journal (ya aplicada en staging; en prod se aplica aquí, es
-- aditiva y el agente queda APAGADO: ai_agent_mode default 'off').
-- Idempotente: si se re-ejecuta sobre una base que ya la tiene, no falla.
-- lock_timeout: drizzle corre todas las migraciones en UNA transacción; si un
-- ALTER TABLE no consigue su lock en 5 s, falla (y se reintenta) en vez de
-- quedarse esperando y bloquear el tráfico detrás de él. Se restablece al final
-- para no afectar a las migraciones siguientes del mismo lote.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."channel_ai_agent_mode" AS ENUM('off', 'borrador', 'auto');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."conversation_agent_state" AS ENUM('activo', 'pausado_humano', 'pausado_handover', 'pausado_antibucle');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TYPE "public"."message_source" ADD VALUE IF NOT EXISTS 'ai_agent';--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "ai_agent_mode" "channel_ai_agent_mode" DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "agent_state" "conversation_agent_state" DEFAULT 'activo' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "agent_paused_until" timestamp;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "last_inbound_at" timestamp;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "last_agent_reply_at" timestamp;--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "response_delay_seconds" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "max_wait_seconds" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "handover_reactivate_hours" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "anti_loop_max_per_hour" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "max_replies_per_contact" integer;--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
