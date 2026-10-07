-- Agente IA › Seguimientos (Parte 4, 6-oct-2026, docs/seguimientos.md §16): la tabla de casos editable y el horario de
-- los vendedores por organización. Columnas nuevas nulas (null = de fábrica), sin tocar datos.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN "seguimientos_casos" jsonb;--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN "seguimientos_vendedores" jsonb;
