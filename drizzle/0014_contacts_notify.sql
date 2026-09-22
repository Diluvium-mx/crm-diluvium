-- Tiempo real de Contactos: un contacto NUEVO avisa por NOTIFY en el mismo canal
-- "inbox_events" que la bandeja (GET /api/inbox/stream). Así el primer mensaje
-- de un número desconocido aparece en el kanban (columna Inbox, arriba) sin
-- recargar, venga del webhook, de un formulario o de una importación.
--
-- Trigger POR SENTENCIA con tabla de transición: una sentencia con pocos
-- contactos (la ingesta crea uno a la vez) avisa uno por uno; una grande (un
-- lote de importación) manda UN solo `contacts.bulk` por organización. Así una
-- importación de 50,000 filas no genera 50,000 NOTIFY. NOTIFY sale al COMMIT.
CREATE OR REPLACE FUNCTION contacts_notify() RETURNS trigger AS $$
DECLARE
  total integer;
  r record;
BEGIN
  SELECT count(*) INTO total FROM new_contacts;
  IF total <= 20 THEN
    FOR r IN SELECT id, organization_id FROM new_contacts LOOP
      PERFORM pg_notify('inbox_events', json_build_object(
        'org', r.organization_id, 'type', 'contact.created', 'contactId', r.id)::text);
    END LOOP;
  ELSE
    FOR r IN SELECT DISTINCT organization_id FROM new_contacts LOOP
      PERFORM pg_notify('inbox_events', json_build_object(
        'org', r.organization_id, 'type', 'contacts.bulk')::text);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER contacts_created_notify AFTER INSERT ON "contacts"
  REFERENCING NEW TABLE AS new_contacts
  FOR EACH STATEMENT EXECUTE FUNCTION contacts_notify();
