CREATE TABLE "opiniones" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text,
	"conversation_id" text,
	"token" text NOT NULL,
	"codigo" text NOT NULL,
	"prueba" boolean DEFAULT false NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"answered_at" timestamp,
	"estrellas" smallint,
	"texto" text,
	"lluvia" text,
	"permiso" text,
	"nombre" text,
	"ciudad" text,
	"permiso_texto" text,
	CONSTRAINT "opiniones_estrellas_check" CHECK ("opiniones"."estrellas" is null or "opiniones"."estrellas" between 1 and 5),
	CONSTRAINT "opiniones_lluvia_check" CHECK ("opiniones"."lluvia" is null or "opiniones"."lluvia" in ('resistio', 'se_metio', 'todavia_no')),
	CONSTRAINT "opiniones_permiso_check" CHECK ("opiniones"."permiso" is null or "opiniones"."permiso" in ('con_nombre', 'sin_nombre', 'no'))
);
--> statement-breakpoint
CREATE TABLE "opiniones_config" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"google_resena_url" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by_user_id" text
);
--> statement-breakpoint
ALTER TABLE "opiniones" ADD CONSTRAINT "opiniones_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opiniones" ADD CONSTRAINT "opiniones_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opiniones" ADD CONSTRAINT "opiniones_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opiniones" ADD CONSTRAINT "opiniones_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opiniones_config" ADD CONSTRAINT "opiniones_config_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opiniones_config" ADD CONSTRAINT "opiniones_config_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "opiniones_token_uidx" ON "opiniones" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "opiniones_org_codigo_uidx" ON "opiniones" USING btree ("organization_id","codigo");--> statement-breakpoint
CREATE INDEX "opiniones_org_created_idx" ON "opiniones" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "opiniones_contact_idx" ON "opiniones" USING btree ("contact_id");