CREATE TABLE "links_pago_textos" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"mensaje_1" text,
	"mensaje_2" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "links_pago" ADD COLUMN "solo_vendedor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "links_pago_textos" ADD CONSTRAINT "links_pago_textos_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;