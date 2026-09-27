-- Columnas del Embudo editables (26-sep-2026). Las 5 etapas fijas del enum
-- `contact_stage` pasan a filas de `funnel_stages` por organización (mismas claves y
-- nombres); `contacts.stage` y `workflows.trigger_stage` guardan la clave como texto
-- con llave foránea compuesta. Ningún contacto cambia de etapa: el valor de texto es
-- idéntico al del enum (conteos por etapa iguales antes y después).
--
-- lock_timeout: drizzle corre todo en UNA transacción; si un ALTER no consigue su
-- lock en 5 s, falla (y el pre-deploy se reintenta) en vez de bloquear el tráfico.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "funnel_stages" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"position" smallint NOT NULL,
	"color" text NOT NULL,
	"role" text,
	"bot_rule" text DEFAULT '' NOT NULL,
	"model_slot" smallint DEFAULT 2 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "funnel_stages_key_check" CHECK ("funnel_stages"."key" ~ '^[a-z0-9_]{1,40}$'),
	CONSTRAINT "funnel_stages_name_check" CHECK (length(btrim("funnel_stages"."name")) between 1 and 40),
	CONSTRAINT "funnel_stages_position_check" CHECK ("funnel_stages"."position" >= 1),
	CONSTRAINT "funnel_stages_color_check" CHECK ("funnel_stages"."color" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "funnel_stages_model_slot_check" CHECK ("funnel_stages"."model_slot" in (1, 2)),
	CONSTRAINT "funnel_stages_bot_rule_check" CHECK (length("funnel_stages"."bot_rule") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "funnel_stages" ADD CONSTRAINT "funnel_stages_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_stages_org_key_uidx" ON "funnel_stages" USING btree ("organization_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_stages_org_role_uidx" ON "funnel_stages" USING btree ("organization_id","role") WHERE "funnel_stages"."role" is not null;--> statement-breakpoint
CREATE INDEX "funnel_stages_org_position_idx" ON "funnel_stages" USING btree ("organization_id","position");--> statement-breakpoint
-- Las 5 etapas de siempre, con la misma clave y nombre, para toda organización que
-- ya existe. La regla del bot de cada una es la del bloque "ETAPAS DEL EMBUDO" del
-- Goal de producción (26-sep-2026); el modelo sale de ai_config.etapas_modelo_1
-- (Modelo 1 = las etapas listadas ahí; sin fila, Inbox/Prospecto/Interesado).
CREATE OR REPLACE FUNCTION funnel_stages_defaults()
RETURNS TABLE ("key" text, "name" text, "position" smallint, "color" text, "role" text, "bot_rule" text) AS $$
  VALUES
    ('inbox', 'Inbox', 1::smallint, '#64748B', 'entrada', ''),
    ('prospecto', 'Prospecto', 2::smallint, '#0A559A', NULL, 'Cuando el cliente contesta por primera vez.'),
    ('interesado', 'Interesado', 3::smallint, '#0891B2', NULL, 'Cuando pregunta precio o da medidas.'),
    ('cerca_compra', 'Cerca de compra', 4::smallint, '#7C3AED', 'cerca_compra', 'Cuando recibe los datos bancarios, o cuando confirmas un anticipo.'),
    ('compra', 'Compra', 5::smallint, '#059669', 'venta_cerrada', 'Cuando confirmas un comprobante válido por el total (o por lo que faltaba).')
$$ LANGUAGE sql IMMUTABLE;
--> statement-breakpoint
INSERT INTO "funnel_stages" ("id", "organization_id", "key", "name", "position", "color", "role", "bot_rule", "model_slot")
SELECT
	gen_random_uuid()::text,
	o."id",
	d."key",
	d."name",
	d."position",
	d."color",
	d."role",
	d."bot_rule",
	CASE
		WHEN d."key" = ANY (COALESCE(c."etapas_modelo_1", ARRAY['inbox', 'prospecto', 'interesado']::text[])) THEN 1
		ELSE 2
	END
FROM "organization" o
LEFT JOIN "ai_config" c ON c."organization_id" = o."id"
CROSS JOIN funnel_stages_defaults() d
ON CONFLICT ("organization_id", "key") DO NOTHING;
--> statement-breakpoint
-- Toda organización NUEVA nace con las 5 etapas (igual que las tallas y los
-- workflows predeterminados, pero desde la base: así la llave foránea de contacts
-- siempre tiene a dónde apuntar, también en las pruebas).
CREATE OR REPLACE FUNCTION funnel_stages_seed_org() RETURNS trigger AS $$
BEGIN
  INSERT INTO "funnel_stages" ("id", "organization_id", "key", "name", "position", "color", "role", "bot_rule", "model_slot")
  SELECT gen_random_uuid()::text, NEW."id", d."key", d."name", d."position", d."color", d."role", d."bot_rule",
         CASE WHEN d."key" IN ('inbox', 'prospecto', 'interesado') THEN 1 ELSE 2 END
  FROM funnel_stages_defaults() d
  ON CONFLICT ("organization_id", "key") DO NOTHING;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER funnel_stages_seed_org AFTER INSERT ON "organization"
  FOR EACH ROW EXECUTE FUNCTION funnel_stages_seed_org();--> statement-breakpoint
-- contacts.stage: enum → texto con la MISMA cadena. El default del enum se quita
-- antes (Postgres no lo convierte solo) y se vuelve a poner como texto.
ALTER TABLE "contacts" ALTER COLUMN "stage" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "contacts" ALTER COLUMN "stage" SET DATA TYPE text USING "stage"::text;--> statement-breakpoint
ALTER TABLE "contacts" ALTER COLUMN "stage" SET DEFAULT 'inbox';--> statement-breakpoint
ALTER TABLE "workflows" ALTER COLUMN "trigger_stage" SET DATA TYPE text USING "trigger_stage"::text;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_stage_fk" FOREIGN KEY ("organization_id","stage") REFERENCES "public"."funnel_stages"("organization_id","key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_trigger_stage_fk" FOREIGN KEY ("organization_id","trigger_stage") REFERENCES "public"."funnel_stages"("organization_id","key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_org_stage_idx" ON "contacts" USING btree ("organization_id","stage");--> statement-breakpoint
DROP TYPE "public"."contact_stage";--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
