CREATE TABLE "contact_stage_history" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"from_stage" text NOT NULL,
	"from_name" text NOT NULL,
	"to_stage" text NOT NULL,
	"to_name" text NOT NULL,
	"changed_by" text NOT NULL,
	"user_id" text,
	"author_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_stage_history" ADD CONSTRAINT "contact_stage_history_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_stage_history" ADD CONSTRAINT "contact_stage_history_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_stage_history" ADD CONSTRAINT "contact_stage_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_stage_history_org_created_idx" ON "contact_stage_history" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "contact_stage_history_contact_idx" ON "contact_stage_history" USING btree ("contact_id");--> statement-breakpoint
-- Historial de etapas (9-oct-2026): el nombre del vendedor EN ESE MOMENTO, con el mismo trigger del
-- Historial del Agente IA (0053). Sin sembrar: la tabla empieza vacía por decisión del dueño.
CREATE TRIGGER contact_stage_history_fijar_autor BEFORE INSERT ON "contact_stage_history"
  FOR EACH ROW EXECUTE FUNCTION historial_fijar_autor('user_id');
