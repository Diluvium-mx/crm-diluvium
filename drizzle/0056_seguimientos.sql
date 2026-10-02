-- Seguimientos del Agente IA, Parte 1 en MODO ENSAYO (2-oct-2026, docs/seguimientos.md): una fila por
-- pendiente de un chat parado (lib/db/schema/followups.ts). Tabla nueva, sin tocar datos existentes.
-- Es la 0056 porque la 0055 la tomó la rama de Instagram (en paralelo); quien llegue segundo a main
-- revisa el número (docs/migraciones.md).
-- lock_timeout: drizzle corre todo en UNA transacción; si una llave foránea no consigue su lock en
-- 5 s, falla (y el pre-deploy se reintenta) en vez de bloquear el tráfico.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "follow_ups" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"caso" text NOT NULL,
	"status" text DEFAULT 'programado' NOT NULL,
	"ensayo" boolean DEFAULT true NOT NULL,
	"intento" smallint DEFAULT 1 NOT NULL,
	"total_intentos" smallint DEFAULT 0 NOT NULL,
	"pendiente" text,
	"siguiente_paso" text,
	"motivo" text,
	"borrador" text,
	"fecha_pedida" text,
	"hora_pedida" text,
	"time_zone" text NOT NULL,
	"due_at" timestamp,
	"door" text,
	"template_name" text,
	"modo" text DEFAULT 'automatico' NOT NULL,
	"presentar_at" timestamp,
	"auto_aprobado" boolean DEFAULT false NOT NULL,
	"due_set_by" text DEFAULT 'sistema' NOT NULL,
	"intentos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cancel_reason" text,
	"based_on_message_at" timestamp NOT NULL,
	"closed_at" timestamp,
	"updated_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "follow_ups_caso_check" CHECK ("follow_ups"."caso" in ('no_seguir', 'asesor_sin_respuesta', 'pidio_fecha', 'pago_pendiente', 'objecion', 'cotizacion_sin_respuesta', 'faltan_medidas', 'precio_sin_respuesta', 'solo_informacion', 'sin_punto_claro')),
	CONSTRAINT "follow_ups_status_check" CHECK ("follow_ups"."status" in ('programado', 'esperando', 'contestado', 'cancelado', 'terminado', 'no_seguir')),
	CONSTRAINT "follow_ups_door_check" CHECK ("follow_ups"."door" is null or "follow_ups"."door" in ('texto', 'plantilla')),
	CONSTRAINT "follow_ups_modo_check" CHECK ("follow_ups"."modo" in ('automatico', 'sugerido')),
	CONSTRAINT "follow_ups_due_set_by_check" CHECK ("follow_ups"."due_set_by" in ('sistema', 'vendedor')),
	CONSTRAINT "follow_ups_intento_check" CHECK ("follow_ups"."intento" between 1 and 3 and "follow_ups"."total_intentos" between 0 and 3)
);
--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "follow_ups_one_open_per_conversation" ON "follow_ups" USING btree ("organization_id","conversation_id") WHERE "follow_ups"."status" in ('programado', 'esperando');--> statement-breakpoint
CREATE INDEX "follow_ups_due_idx" ON "follow_ups" USING btree ("status","due_at") WHERE "follow_ups"."status" in ('programado', 'esperando');--> statement-breakpoint
CREATE INDEX "follow_ups_conversation_idx" ON "follow_ups" USING btree ("organization_id","conversation_id","created_at");