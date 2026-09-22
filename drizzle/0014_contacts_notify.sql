-- Tiempo real de Contactos: un contacto NUEVO avisa por NOTIFY en el mismo canal
-- "inbox_events" que la bandeja (GET /api/inbox/stream). Así el primer mensaje
-- de un número desconocido aparece en el kanban (columna Inbox, arriba) sin
-- recargar, venga del webhook, de un formulario o de una importación. Solo
-- INSERT: el kanban ya maneja sus propios cambios de etapa. NOTIFY sale al
-- COMMIT. En una importación masiva el kanban recibe muchos avisos; los agrupa.
CREATE OR REPLACE FUNCTION contacts_notify() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('inbox_events', json_build_object(
    'org', NEW.organization_id, 'type', 'contact.created', 'contactId', NEW.id)::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER contacts_created_notify AFTER INSERT ON "contacts"
  FOR EACH ROW EXECUTE FUNCTION contacts_notify();
