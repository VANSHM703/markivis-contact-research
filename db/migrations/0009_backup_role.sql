-- Backups (BRD 19 recovery). Forced row-level security applies even to the schema owner, so the
-- owner cannot take a complete pg_dump. The read-only dmi_backup role (db/bootstrap.sql, with
-- BYPASSRLS) can, once it may read every table in dmi and the migration journal. Where the
-- cluster has no such role, nothing happens; the host's own backups still apply.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dmi_backup') THEN
    GRANT USAGE ON SCHEMA dmi, drizzle TO dmi_backup;
    GRANT SELECT ON ALL TABLES IN SCHEMA dmi TO dmi_backup;
    GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO dmi_backup;
    GRANT SELECT ON ALL SEQUENCES IN SCHEMA dmi TO dmi_backup;
    GRANT SELECT ON ALL SEQUENCES IN SCHEMA drizzle TO dmi_backup;
    ALTER DEFAULT PRIVILEGES IN SCHEMA dmi GRANT SELECT ON TABLES TO dmi_backup;
    ALTER DEFAULT PRIVILEGES IN SCHEMA dmi GRANT SELECT ON SEQUENCES TO dmi_backup;
  END IF;
END
$$;
