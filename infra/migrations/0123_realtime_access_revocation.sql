-- baytak - 0123: fan out committed account/RBAC revocations to every API instance.

CREATE OR REPLACE FUNCTION notify_realtime_access_revoked_for_user_row()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  affected_user_id UUID;
BEGIN
  affected_user_id := COALESCE(NEW.id, OLD.id);
  PERFORM pg_notify('baytak_realtime_access_revoked', affected_user_id::text);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION notify_realtime_access_revoked_for_user_role()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  affected_user_id UUID;
BEGIN
  affected_user_id := COALESCE(NEW.user_id, OLD.user_id);
  PERFORM pg_notify('baytak_realtime_access_revoked', affected_user_id::text);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION notify_realtime_access_revoked_for_role()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  affected_role_id UUID;
  assigned_user RECORD;
BEGIN
  IF TG_TABLE_NAME = 'role_permissions' THEN
    affected_role_id := COALESCE(NEW.role_id, OLD.role_id);
  ELSE
    affected_role_id := COALESCE(NEW.id, OLD.id);
  END IF;
  FOR assigned_user IN SELECT user_id FROM user_roles WHERE role_id = affected_role_id LOOP
    PERFORM pg_notify('baytak_realtime_access_revoked', assigned_user.user_id::text);
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_users_realtime_access_revoked
  AFTER UPDATE OF is_active, is_blocked OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION notify_realtime_access_revoked_for_user_row();

CREATE TRIGGER trg_user_roles_realtime_access_revoked
  AFTER INSERT OR DELETE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION notify_realtime_access_revoked_for_user_role();

CREATE TRIGGER trg_role_permissions_realtime_access_revoked
  AFTER INSERT OR DELETE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION notify_realtime_access_revoked_for_role();

CREATE TRIGGER trg_roles_realtime_access_revoked
  AFTER UPDATE OF is_active OR DELETE ON roles
  FOR EACH ROW EXECUTE FUNCTION notify_realtime_access_revoked_for_role();
