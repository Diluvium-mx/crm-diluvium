CREATE TYPE "public"."contact_temperature" AS ENUM('caliente', 'frio', 'en_espera', 'destacado');--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "temperature" "contact_temperature";