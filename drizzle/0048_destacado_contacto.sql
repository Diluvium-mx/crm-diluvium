-- Destacado del contacto (29-sep-2026, regla del dueño): Destacado deja de ser una temperatura
-- y deja de ser una marca del chat. Es UNA marca del contacto, combinable con cualquier
-- temperatura (🔥 + ⭐): la estrella de la lista de la Bandeja y el ⭐ del Embudo son este dato.
-- 1) contacts.destacado: ADD COLUMN con default constante no reescribe la tabla (PG ≥ 11).
-- 2) Queda destacado todo contacto con temperatura ⭐ o con algún chat con estrella
--    (conversations.is_starred, que desde aquí queda sin uso).
-- 3) La temperatura ⭐ pasa a «Sin asignar»: ya no es temperatura. Nadie pierde 🔥, 🧊 ni ⏳.
--    El valor 'destacado' se queda en el tipo contact_temperature (un valor de enum no se quita
--    sin reescribir); la app ya no lo acepta.
-- Ningún trigger de contacts dispara con UPDATE (el de la 0016 es solo de INSERT).
-- IDEMPOTENTE (IF NOT EXISTS; los UPDATE no cambian nada la segunda vez) y con lock_timeout.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "destacado" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "contacts" c SET "destacado" = true
WHERE c."destacado" = false
  AND (
    c."temperature" = 'destacado'
    OR EXISTS (
      SELECT 1 FROM "conversations" cv
      WHERE cv."contact_id" = c."id" AND cv."organization_id" = c."organization_id" AND cv."is_starred"
    )
  );--> statement-breakpoint
UPDATE "contacts" SET "temperature" = NULL WHERE "temperature" = 'destacado';--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
