CREATE TABLE "links_pago" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"nombre" text NOT NULL,
	"monto" numeric(12, 2) NOT NULL,
	"cubre" text NOT NULL,
	"meses" smallint DEFAULT 0 NOT NULL,
	"url" text NOT NULL,
	"posicion" smallint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "links_pago_monto_check" CHECK ("links_pago"."monto" > 0),
	CONSTRAINT "links_pago_cubre_check" CHECK ("links_pago"."cubre" in ('total', 'mitad')),
	CONSTRAINT "links_pago_meses_check" CHECK ("links_pago"."meses" between 0 and 24)
);
--> statement-breakpoint
ALTER TABLE "links_pago" ADD CONSTRAINT "links_pago_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "links_pago_org_idx" ON "links_pago" USING btree ("organization_id","posicion");