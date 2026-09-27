-- Nombre de las versiones del Goal y de las FAQs (27-sep-2026, pestaña Agente IA): el lápiz ✎
-- de cada versión le pone un nombre ("Antes de la promo"). NULL = sin nombre (se ve solo la
-- fecha). IDEMPOTENTE (IF NOT EXISTS), igual que la 0035–0039; no toca datos.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "ai_knowledge_versions" ADD COLUMN IF NOT EXISTS "name" text;--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
