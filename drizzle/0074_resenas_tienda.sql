-- Reseñas en Amazon y Mercado Libre (27-oct-2026, docs/opiniones.md): el lector anota al cliente que dijo en el chat
-- que compró ahí y el vendedor le pide la reseña desde Seguimientos. Enlaces de las tiendas en opiniones_config.
CREATE TABLE "resenas_tienda" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"conversation_id" text,
	"tienda" text NOT NULL,
	"frase" text,
	"origen" text DEFAULT 'lector' NOT NULL,
	"estado" text DEFAULT 'por_pedir' NOT NULL,
	"pedida_at" timestamp,
	"pedida_por_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "resenas_tienda_tienda_check" CHECK ("resenas_tienda"."tienda" in ('amazon', 'mercado_libre')),
	CONSTRAINT "resenas_tienda_origen_check" CHECK ("resenas_tienda"."origen" in ('lector', 'manual')),
	CONSTRAINT "resenas_tienda_estado_check" CHECK ("resenas_tienda"."estado" in ('por_pedir', 'pedida', 'la_dejo', 'no_quiso', 'descartada'))
);
--> statement-breakpoint
ALTER TABLE "opiniones_config" ADD COLUMN "amazon_resena_url" text;--> statement-breakpoint
ALTER TABLE "opiniones_config" ADD COLUMN "mercado_libre_resena_url" text;--> statement-breakpoint
ALTER TABLE "resenas_tienda" ADD CONSTRAINT "resenas_tienda_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resenas_tienda" ADD CONSTRAINT "resenas_tienda_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resenas_tienda" ADD CONSTRAINT "resenas_tienda_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resenas_tienda" ADD CONSTRAINT "resenas_tienda_pedida_por_user_id_user_id_fk" FOREIGN KEY ("pedida_por_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resenas_tienda_org_contact_uidx" ON "resenas_tienda" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE INDEX "resenas_tienda_org_created_idx" ON "resenas_tienda" USING btree ("organization_id","created_at");