-- Número de prueba (docs/numero-prueba.md): canales de prueba, archivados y con hora de
-- conexión, contactos de prueba y mensajes importados del historial del celular (coexistencia).
-- (El snapshot 0031 no traía workflow_runs.trigger_message_id, que la 0031 SÍ crea: este
-- snapshot lo corrige sin volver a crear la columna.)
ALTER TABLE "contacts" ADD COLUMN "es_prueba" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "is_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "connected_at" timestamp;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "imported_at" timestamp;
