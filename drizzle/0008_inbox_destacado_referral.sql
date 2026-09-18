ALTER TABLE "conversations" ADD COLUMN "is_starred" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "ad_referral" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "ad_referral" jsonb;--> statement-breakpoint
CREATE INDEX "messages_conversation_sent_idx" ON "messages" USING btree ("conversation_id","sent_at" desc);--> statement-breakpoint
-- Tiempo real de la bandeja (GET /api/inbox/stream): cada cambio de un
-- mensaje o una conversación avisa por NOTIFY en el canal "inbox_events".
-- Va en la BASE, no en el código, para que ningún camino que escriba (worker,
-- envío, estados, descarga de media, scripts) se quede sin avisar. NOTIFY sale
-- solo al hacer COMMIT (un rollback no avisa). Payload mínimo: la UI vuelve a
-- pedir la fila.
CREATE OR REPLACE FUNCTION inbox_notify() RETURNS trigger AS $$
BEGIN
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
CREATE TRIGGER messages_inbox_notify AFTER INSERT OR UPDATE OR DELETE ON "messages"
  FOR EACH ROW EXECUTE FUNCTION inbox_notify();
--> statement-breakpoint
CREATE TRIGGER conversations_inbox_notify AFTER INSERT OR UPDATE ON "conversations"
  FOR EACH ROW EXECUTE FUNCTION inbox_notify();
