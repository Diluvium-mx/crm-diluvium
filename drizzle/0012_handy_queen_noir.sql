CREATE TABLE "ai_config" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"modelo_filtro" text NOT NULL,
	"modelo_cerebro" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_config" ADD CONSTRAINT "ai_config_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;