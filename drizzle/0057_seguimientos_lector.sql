-- Seguimientos (3-oct-2026): "pidió fecha" guarda el asunto pendiente (la hora sale de él si el cliente
-- solo dijo el día) y la plantilla que eligió el lector para el 2.º y el 3.er intento. docs/seguimientos.md.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "caso_de_fondo" text;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "plantilla_2" text;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "plantilla_3" text;