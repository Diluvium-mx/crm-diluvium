CREATE TABLE "spelling_words" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"word" text NOT NULL,
	"word_key" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spelling_words" ADD CONSTRAINT "spelling_words_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spelling_words" ADD CONSTRAINT "spelling_words_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spelling_words_org_key_uidx" ON "spelling_words" USING btree ("organization_id","word_key");