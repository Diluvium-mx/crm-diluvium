-- Continuación de las notas de más de 5000 caracteres (hallazgo de la revisión de
-- Codex sobre la 0022, que solo copió los primeros 5000: el CHECK de
-- contact_comentarios limita cada comentario a 5000). La 0022 ya está aplicada y
-- no se edita; esta completa lo que faltaba sin tocarla.
--
-- El resto de la nota (desde el carácter 5001) se parte en comentarios de
-- continuación de hasta 4985 caracteres con el prefijo "(continuación) ", del
-- mismo autor de sistema "Importado". Su created_at va 1 ms, 2 ms… ANTES del de la
-- 0022: la lista de comentarios (más reciente arriba) los muestra en orden de
-- lectura. Idempotente (id determinista + ON CONFLICT). No borra
-- custom_fields.notas. Al 23-sep-2026 staging y prod tenían 0 notas.
--
-- También inserta la PRIMERA parte (los primeros 5000, con el mismo id que usa
-- la 0022) si no existe: si una nota larga apareció después de correr la 0022,
-- no quedan continuaciones sin su principio. Donde la 0022 ya la copió, choca con
-- ese id y no hace nada.
INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at", "banned", "ban_reason")
SELECT 'usuario-sistema-importado', 'Importado', 'importado@sistema.invalid', false, now(), now(), true,
       'Usuario del sistema: autor de las notas importadas (no inicia sesión)'
WHERE EXISTS (
  SELECT 1 FROM "contacts"
  WHERE jsonb_typeof("custom_fields"->'notas') = 'string' AND length(trim("custom_fields"->>'notas')) > 5000
)
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "contact_comentarios" ("id", "organization_id", "contact_id", "author_user_id", "body", "created_at")
SELECT 'nota-importada-' || c."id", c."organization_id", c."id", 'usuario-sistema-importado',
       left(trim(c."custom_fields"->>'notas'), 5000), c."created_at"
FROM "contacts" c
WHERE jsonb_typeof(c."custom_fields"->'notas') = 'string' AND length(trim(c."custom_fields"->>'notas')) > 5000
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "contact_comentarios" ("id", "organization_id", "contact_id", "author_user_id", "body", "created_at")
SELECT 'nota-importada-' || c."id" || '-' || (j + 1),
       c."organization_id",
       c."id",
       'usuario-sistema-importado',
       '(continuación) ' || substr(n.resto, (j - 1) * 4985 + 1, 4985),
       c."created_at" - j * interval '1 millisecond'
FROM "contacts" c
CROSS JOIN LATERAL (SELECT substr(trim(c."custom_fields"->>'notas'), 5001) AS resto) n
CROSS JOIN LATERAL generate_series(1, ceil(length(n.resto) / 4985.0)::int) AS j
WHERE jsonb_typeof(c."custom_fields"->'notas') = 'string' AND length(trim(c."custom_fields"->>'notas')) > 5000
ON CONFLICT ("id") DO NOTHING;
