-- Tabla de tamaños + «El workflow es la respuesta» (29-sep-2026, decisiones del dueño). Es la 0051:
-- la 0050 es la búsqueda en los chats (pg_trgm), ya en main.
-- 1) trigger_start_only_agent: con «Solo al inicio», ¿también el Agente IA queda limitado? Nace en
--    true: «Precio 2» e «Información» siguen con la regla estricta de siempre. false = tercera
--    opción («Solo al inicio por palabra clave; el Agente IA cuando haga falta»), la de la Tabla.
-- 2) max_sends_per_chat: «Máximo de envíos por chat» (null = sin límite; nace sin límite en todos).
-- 3) is_answer: «El workflow es la respuesta». Reemplaza la regla automática "si termina en
--    pregunta, el Agente IA espera": nace marcada en los que HOY terminan en pregunta (texto o pie
--    del último paso con "?" al final, seguido si acaso de espacios, emojis o signos; la misma
--    regla que endsWithQuestion de lib/workflows/steps.ts), así nada cambia para ellos.
-- Columnas con valor constante: no reescriben la tabla.
-- IDEMPOTENTE (IF NOT EXISTS) y con lock_timeout, igual que la 0049.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN IF NOT EXISTS "trigger_start_only_agent" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN IF NOT EXISTS "max_sends_per_chat" integer;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN IF NOT EXISTS "is_answer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "workflows" w SET "is_answer" = true
WHERE NOT w."is_answer" AND EXISTS (
  SELECT 1 FROM "workflow_steps" s
  WHERE s."workflow_id" = w."id" AND s."organization_id" = w."organization_id"
    AND s."position" = (SELECT max(s2."position") FROM "workflow_steps" s2 WHERE s2."workflow_id" = w."id")
    AND btrim(CASE s."kind" WHEN 'send_text' THEN s."payload"->>'text' WHEN 'send_media' THEN coalesce(s."payload"->>'caption', '') ELSE '' END) ~ '\?[^[:alpha:][:digit:]]*$'
);--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
