-- Run once per PostgreSQL cluster as a superuser (psql -f db/bootstrap.sql).
-- Local development credentials only. Production uses the host's secrets manager.
--
-- dmi         owns the schema and runs migrations
-- dmi_app     the application login; row-level security always applies to it
-- dmi_system  no login, BYPASSRLS; dmi_app may SET ROLE to it for the few operations that
--             must span workspaces (sign-in identity lookup, scheduler, seeding). See DECISIONS.md.
-- dmi_jobs    the job queue's login (pg-boss). Owns only schema pgboss and cannot read schema dmi.

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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dmi_jobs') THEN
    CREATE ROLE dmi_jobs LOGIN PASSWORD 'dmi_jobs' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

GRANT dmi_system TO dmi_app;

SELECT 'CREATE DATABASE dmi OWNER dmi' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'dmi')\gexec
SELECT 'CREATE DATABASE dmi_test OWNER dmi' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'dmi_test')\gexec
SELECT 'CREATE DATABASE dmi_e2e OWNER dmi' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'dmi_e2e')\gexec
-- The performance check (npm run perf) fills its own database with 50,000 people.
SELECT 'CREATE DATABASE dmi_perf OWNER dmi' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'dmi_perf')\gexec

-- pg-boss creates and migrates its own schema on start, so the jobs role needs CREATE on each database.
GRANT CREATE ON DATABASE dmi TO dmi_jobs;
GRANT CREATE ON DATABASE dmi_test TO dmi_jobs;
GRANT CREATE ON DATABASE dmi_e2e TO dmi_jobs;
GRANT CREATE ON DATABASE dmi_perf TO dmi_jobs;
