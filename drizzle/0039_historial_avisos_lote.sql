-- Historial del celular a escala (26-sep-2026, docs/go-live.md): avisos de tiempo real
-- EN LOTE durante la importación. IDEMPOTENTE (CREATE OR REPLACE), sin tocar datos.
--
-- Los triggers de la 0008 (mensajes y conversaciones) y de la 0016 (contactos nuevos)
-- avisan por NOTIFY en cada fila. Importar 50,000 mensajes del historial serían 50,000
-- avisos y la Bandeja y el Embudo abiertos se recargarían sin parar. Ahora, si la
-- TRANSACCIÓN marcó `crm.avisos_en_lote = 'on'` (set_config local: se apaga sola al
-- terminar la transacción y no afecta a ninguna otra conexión), el trigger no avisa;
-- el importador manda UN aviso `inbox.bulk` cada 500 mensajes o cada 5 s. Todo lo
-- demás (webhook, envíos, worker, pantallas) sigue avisando fila por fila, igual que hoy.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE OR REPLACE FUNCTION inbox_notify() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('crm.avisos_en_lote', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    -- Solo se borra la fila en cola cuando el eco del envío ganó la carrera.
    PERFORM pg_notify('inbox_events', json_build_object(
      'org', OLD.organization_id, 'type', 'message.deleted',
      'conversationId', OLD.conversation_id, 'messageId', OLD.id)::text);
  ELSIF TG_TABLE_NAME = 'messages' THEN
    PERFORM pg_notify('inbox_events', json_build_object(
      'org', NEW.organization_id, 'type', 'message.upserted',
      'conversationId', NEW.conversation_id, 'messageId', NEW.id)::text);
  ELSE
    PERFORM pg_notify('inbox_events', json_build_object(
      'org', NEW.organization_id, 'type', 'conversation.updated',
      'conversationId', NEW.id)::text);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION contacts_notify() RETURNS trigger AS $$
DECLARE
  total integer;
  r record;
BEGIN
  IF coalesce(current_setting('crm.avisos_en_lote', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
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
SET LOCAL lock_timeout = DEFAULT;
