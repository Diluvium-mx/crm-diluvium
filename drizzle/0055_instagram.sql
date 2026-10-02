-- Canal Instagram (2-oct-2026, docs/instagram.md): DMs de Instagram por Zernio.
-- lock_timeout: drizzle corre las migraciones en UNA transacción; si un ALTER no
-- consigue su lock en 5 s, falla (y se reintenta) en vez de bloquear el tráfico.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
-- El valor nuevo no se usa en esta misma transacción (Postgres no lo permite).
ALTER TYPE "public"."channel_type" ADD VALUE IF NOT EXISTS 'instagram';--> statement-breakpoint
-- Cliente de Instagram: su id para nuestra cuenta (IGSID) es su identidad; el
-- @usuario es solo para mostrar y buscar. Sin teléfono.
ALTER TABLE "contacts" ADD COLUMN "instagram_id" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "instagram_username" text;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_org_instagram_id_uidx" ON "contacts" USING btree ("organization_id","instagram_id") WHERE "contacts"."instagram_id" is not null;--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
