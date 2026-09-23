-- A10: copia las notas viejas (contacts.custom_fields->>'notas') a comentarios del
-- contacto, SIN borrar custom_fields.notas. Idempotente: cada comentario usa un
-- id determinista por contacto y se ignora si ya existe.
--
-- Autor: los comentarios exigen autor (author_user_id NOT NULL). Las notas no lo
-- tienen, así que se usa un usuario de SISTEMA "Importado" que no puede iniciar
-- sesión (sin cuenta de contraseña, y banned) ni es miembro de ninguna
-- organización (no aparece en Vendedores). Como nadie entra como él, sus
-- comentarios solo los editan/borran owner/admin. Solo se crea si hay notas.
--
-- Fecha: contacts no tiene updated_at; se usa created_at del contacto.
-- Al 22-sep-2026 staging y prod tenían 0 notas (SELECT de solo lectura): hoy
-- esta migración no inserta nada; queda para cualquier base que sí las tenga.
INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at", "banned", "ban_reason")
SELECT 'usuario-sistema-importado', 'Importado', 'importado@sistema.invalid', false, now(), now(), true,
       'Usuario del sistema: autor de las notas importadas (no inicia sesión)'
WHERE EXISTS (
  SELECT 1 FROM "contacts"
  WHERE jsonb_typeof("custom_fields"->'notas') = 'string' AND length(trim("custom_fields"->>'notas')) > 0
)
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "contact_comentarios" ("id", "organization_id", "contact_id", "author_user_id", "body", "created_at")
SELECT 'nota-importada-' || c."id", c."organization_id", c."id", 'usuario-sistema-importado',
       left(trim(c."custom_fields"->>'notas'), 5000), c."created_at"
FROM "contacts" c
WHERE jsonb_typeof(c."custom_fields"->'notas') = 'string' AND length(trim(c."custom_fields"->>'notas')) > 0
ON CONFLICT ("id") DO NOTHING;
