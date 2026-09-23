-- lock_timeout: drizzle corre todas las migraciones en UNA transacción; si un
-- ALTER no consigue su lock en 5 s, falla (y se reintenta) en vez de bloquear el
-- tráfico. Se restablece al final para no afectar a las migraciones siguientes.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TYPE "public"."contact_inundaciones" AS ENUM('si', 'no', 'no_sabe');--> statement-breakpoint
CREATE TYPE "public"."linea_compuerta" AS ENUM('mini', 'estandar');--> statement-breakpoint
CREATE TABLE "contact_comentarios" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"author_user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp,
	CONSTRAINT "contact_comentarios_body_check" CHECK (char_length("contact_comentarios"."body") between 1 and 5000)
);
--> statement-breakpoint
CREATE TABLE "contact_entradas" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"posicion" smallint NOT NULL,
	"ancho_cm" integer,
	"linea" "linea_compuerta" DEFAULT 'estandar' NOT NULL,
	"tamano_sugerido" text,
	"tamano_manual" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contact_entradas_contact_posicion_unique" UNIQUE("contact_id","posicion"),
	CONSTRAINT "contact_entradas_posicion_check" CHECK ("contact_entradas"."posicion" > 0),
	CONSTRAINT "contact_entradas_ancho_cm_check" CHECK ("contact_entradas"."ancho_cm" is null or "contact_entradas"."ancho_cm" between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "tallas_compuerta" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"linea" "linea_compuerta" NOT NULL,
	"talla" text NOT NULL,
	"min_cm" integer NOT NULL,
	"max_cm" integer NOT NULL,
	"posicion" smallint NOT NULL,
	CONSTRAINT "tallas_compuerta_org_linea_talla_unique" UNIQUE("organization_id","linea","talla"),
	CONSTRAINT "tallas_compuerta_rango_check" CHECK ("tallas_compuerta"."min_cm" > 0 and "tallas_compuerta"."min_cm" <= "tallas_compuerta"."max_cm")
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "tiene_inundaciones" "contact_inundaciones";--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "nivel_agua_cm" integer;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "nivel_agua_texto" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "num_entradas" integer;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "monto_cotizacion" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "porcentaje_convencimiento" smallint;--> statement-breakpoint
ALTER TABLE "contact_comentarios" ADD CONSTRAINT "contact_comentarios_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_comentarios" ADD CONSTRAINT "contact_comentarios_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_comentarios" ADD CONSTRAINT "contact_comentarios_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_entradas" ADD CONSTRAINT "contact_entradas_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_entradas" ADD CONSTRAINT "contact_entradas_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tallas_compuerta" ADD CONSTRAINT "tallas_compuerta_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_comentarios_contact_created_idx" ON "contact_comentarios" USING btree ("contact_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "contact_entradas_org_contact_idx" ON "contact_entradas" USING btree ("organization_id","contact_id");--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_nivel_agua_cm_check" CHECK ("contacts"."nivel_agua_cm" is null or "contacts"."nivel_agua_cm" between 0 and 1000);--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_num_entradas_check" CHECK ("contacts"."num_entradas" is null or "contacts"."num_entradas" between 0 and 50);--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_monto_cotizacion_check" CHECK ("contacts"."monto_cotizacion" is null or "contacts"."monto_cotizacion" >= 0);--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_porcentaje_convencimiento_check" CHECK ("contacts"."porcentaje_convencimiento" is null or ("contacts"."porcentaje_convencimiento" between 0 and 100 and "contacts"."porcentaje_convencimiento" % 10 = 0));
--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
