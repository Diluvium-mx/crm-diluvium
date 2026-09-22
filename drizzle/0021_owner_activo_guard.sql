-- lock_timeout: drizzle corre todas las migraciones en UNA transacción; si un
-- ALTER no consigue su lock en 5 s, falla (y se reintenta) en vez de bloquear el
-- tráfico. Se restablece al final para no afectar a las migraciones siguientes.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
-- A4 (capa de BD): toda organización conserva al menos un owner ACTIVO (con
-- membresía y sin estar desactivado). La server action ya lo valida; esto cubre
-- carreras y cualquier otro camino (p. ej. los endpoints HTTP del plugin
-- organization de Better Auth). Triggers DIFERIDOS: se revisa al hacer COMMIT,
-- así una transacción que cambia un owner por otro no falla a la mitad.
-- El mensaje empieza con "org_sin_owner_activo" (lib/team/store.ts lo traduce).
CREATE OR REPLACE FUNCTION crm_check_org_active_owner(org_id text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- La organización se borró (cascade a member): no hay nada que proteger.
  IF NOT EXISTS (SELECT 1 FROM organization WHERE id = org_id) THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM member m
    JOIN "user" u ON u.id = m.user_id
    WHERE m.organization_id = org_id
      AND 'owner' = ANY (string_to_array(m.role, ','))
      AND coalesce(u.banned, false) = false
  ) THEN
    RAISE EXCEPTION 'org_sin_owner_activo: la organización % se quedaría sin owner activo', org_id
      USING ERRCODE = 'check_violation';
  END IF;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION crm_member_owner_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM crm_check_org_active_owner(OLD.organization_id);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER member_keeps_active_owner
  AFTER UPDATE OF role, organization_id OR DELETE ON member
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION crm_member_owner_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION crm_user_owner_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  org text;
BEGIN
  IF coalesce(NEW.banned, false) AND NOT coalesce(OLD.banned, false) THEN
    FOR org IN
      SELECT organization_id FROM member
      WHERE user_id = NEW.id AND 'owner' = ANY (string_to_array(role, ','))
    LOOP
      PERFORM crm_check_org_active_owner(org);
    END LOOP;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER user_keeps_active_owner
  AFTER UPDATE OF banned ON "user"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION crm_user_owner_guard();
--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
