-- Seguimientos del Agente IA, envío real (6-oct-2026, docs/seguimientos.md): interruptor Ensayo/Real por
-- organización, contactos dados de baja de promociones (131050) y marca del aviso al vendedor.
-- 0059 (la 0058 es la de los costos de WhatsApp en el Dashboard, en otra rama).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "sin_seguimientos" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN "seguimientos_real" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "aviso_at" timestamp;