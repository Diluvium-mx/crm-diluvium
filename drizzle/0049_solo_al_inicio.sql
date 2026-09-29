-- «Solo al inicio» (29-sep-2026, decisión del dueño): opción por workflow. Es la 0049: la 0048 es «Destacado»
-- (otra rama); en main debe entrar DESPUÉS de ella para que drizzle no la salte (orden por `when`). Por palabra clave o por el
-- Agente IA, un workflow con esta opción solo se dispara mientras ni el Agente IA (con texto propio)
-- ni un vendedor le han contestado al cliente, y a lo mucho UNA vez por contacto
-- (lib/workflows/start-only.ts). Nace apagada en todos: nada cambia hasta que el dueño la encienda.
-- Una columna con valor constante: no reescribe la tabla.
-- IDEMPOTENTE (IF NOT EXISTS) y con lock_timeout, igual que la 0044.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN IF NOT EXISTS "trigger_start_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
