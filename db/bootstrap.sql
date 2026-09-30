-- Run once per PostgreSQL cluster as a superuser (psql -f db/bootstrap.sql).
-- Local development credentials only. Production uses the host's secrets manager.
--
-- dmi         owns the schema and runs migrations
-- dmi_app     the application login; row-level security always applies to it
-- dmi_system  no login, BYPASSRLS; dmi_app may SET ROLE to it for the few operations that
--             must span workspaces (sign-in identity lookup, scheduler, seeding). See DECISIONS.md.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dmi') THEN
    CREATE ROLE dmi LOGIN PASSWORD 'dmi';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dmi_app') THEN
    CREATE ROLE dmi_app LOGIN PASSWORD 'dmi_app' NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dmi_system') THEN
    CREATE ROLE dmi_system NOLOGIN BYPASSRLS;
  END IF;
END
$$;

GRANT dmi_system TO dmi_app;

SELECT 'CREATE DATABASE dmi OWNER dmi' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'dmi')\gexec
SELECT 'CREATE DATABASE dmi_test OWNER dmi' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'dmi_test')\gexec
SELECT 'CREATE DATABASE dmi_e2e OWNER dmi' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'dmi_e2e')\gexec
