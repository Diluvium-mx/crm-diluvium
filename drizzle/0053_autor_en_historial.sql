ALTER TABLE "ai_config_changes" ADD COLUMN "author_name" text;--> statement-breakpoint
ALTER TABLE "change_history" ADD COLUMN "author_name" text;--> statement-breakpoint
ALTER TABLE "ai_knowledge_versions" ADD COLUMN "author_name" text;--> statement-breakpoint
-- S3 (revisión de seguridad CN-009, 30-sep-2026; decisión del dueño): el Historial guarda el
-- nombre del autor EN ESE MOMENTO. Un trigger lo fija al insertar en las tres fuentes del
-- Historial (cambios, Opciones del Agente IA y versiones del Goal/FAQs), sin tocar el código que
-- escribe en ellas. Las filas que ya existían se rellenan con el nombre actual.
CREATE OR REPLACE FUNCTION historial_fijar_autor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  autor text := to_jsonb(NEW) ->> TG_ARGV[0];
BEGIN
  IF NEW.author_name IS NULL AND autor IS NOT NULL THEN
    SELECT u.name INTO NEW.author_name FROM "user" u WHERE u.id = autor;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER change_history_fijar_autor BEFORE INSERT ON "change_history"
  FOR EACH ROW EXECUTE FUNCTION historial_fijar_autor('user_id');
--> statement-breakpoint
CREATE TRIGGER ai_config_changes_fijar_autor BEFORE INSERT ON "ai_config_changes"
  FOR EACH ROW EXECUTE FUNCTION historial_fijar_autor('user_id');
--> statement-breakpoint
CREATE TRIGGER ai_knowledge_versions_fijar_autor BEFORE INSERT ON "ai_knowledge_versions"
  FOR EACH ROW EXECUTE FUNCTION historial_fijar_autor('created_by_user_id');
--> statement-breakpoint
UPDATE "change_history" h SET "author_name" = u.name FROM "user" u WHERE u.id = h.user_id AND h.author_name IS NULL;
--> statement-breakpoint
UPDATE "ai_config_changes" c SET "author_name" = u.name FROM "user" u WHERE u.id = c.user_id AND c.author_name IS NULL;
--> statement-breakpoint
UPDATE "ai_knowledge_versions" v SET "author_name" = u.name FROM "user" u WHERE u.id = v.created_by_user_id AND v.author_name IS NULL;
