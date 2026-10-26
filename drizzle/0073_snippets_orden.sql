-- Orden manual de los mensajes rápidos (26-oct-2026): el equipo los acomoda arrastrando en Mensajes rápidos
-- y así salen en ⚡ del chat y en «/». Arrancan en el orden de siempre (por nombre, como los ordenaba el CRM).
ALTER TABLE "snippets" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "snippets" AS s SET "position" = o.n
FROM (SELECT "id", (row_number() OVER (PARTITION BY "organization_id" ORDER BY "name", "id") - 1)::integer AS n FROM "snippets") AS o
WHERE s."id" = o."id";