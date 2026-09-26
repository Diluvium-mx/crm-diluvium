-- Agente IA parte 1 (26-sep-2026). IDEMPOTENTE (IF [NOT] EXISTS / ON CONFLICT), igual que la 0035/0036.
-- lock_timeout: drizzle corre las migraciones en UNA transacción; si un ALTER no consigue su lock
-- en 5 s, falla (el pre-deploy lo detiene sin tumbar lo que está atendiendo) en vez de bloquear.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
-- B. Notas de voz: costo de la transcripción en ai_usage (etapa nueva) y el texto en el mensaje.
-- ADD VALUE dentro de la transacción es válido (PG ≥ 12) mientras nada lo use en la misma.
ALTER TYPE "public"."ai_usage_stage" ADD VALUE IF NOT EXISTS 'transcripcion';--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "transcripcion" text;--> statement-breakpoint
-- C. Respuesta guardada cuyo envío falló: la media que iba después del texto ("Reintentar" la corre).
ALTER TABLE "ai_agent_drafts" ADD COLUMN IF NOT EXISTS "runs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- D. Tope diario de $20: nunca se aplicó desde la Fase B; el dueño decidió quitarlo (25-sep).
ALTER TABLE "ai_config" DROP COLUMN IF EXISTS "daily_budget_usd";--> statement-breakpoint
-- A. Autor de SISTEMA de los comentarios que deja el Agente IA en el Detalle del contacto. Igual que
-- "Importado" (0022): no inicia sesión (sin cuenta de contraseña y banned), no es miembro de ninguna
-- organización (no aparece en Vendedores) y su correo es de dominio .invalid (lib/team/store.ts lo
-- reserva). Sus comentarios solo los editan o borran owner/admin.
INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at", "banned", "ban_reason")
VALUES ('usuario-sistema-agente-ia', 'Agente IA', 'agente-ia@sistema.invalid', false, now(), now(), true,
        'Usuario del sistema: autor de los comentarios del Agente IA (no inicia sesión)')
ON CONFLICT DO NOTHING;--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
