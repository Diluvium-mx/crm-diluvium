-- Fase E (25-sep-2026, decisión del dueño): se quita el tope diario de $20 del Agente IA.
-- Nunca se aplicó desde el cierre de la Fase B (el agente va sin presupuesto diario) y
-- solo confundía. Sin datos que migrar.
ALTER TABLE "ai_config" DROP COLUMN "daily_budget_usd";