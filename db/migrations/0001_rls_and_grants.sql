-- Tenancy isolation, BRD 5.1. Hand-written; drizzle-kit does not generate this file.
--
-- Every table with a workspace_id column gets row-level security, forced even for the owner,
-- with one policy: rows are visible and writable only when workspace_id matches the
-- per-transaction setting app.workspace_id (SET LOCAL via set_config(..., true)). When the
-- setting is absent the comparison is against NULL, so no row matches.
--
-- The application logs in as dmi_app (subject to RLS). The query layer (src/db/client.ts)
-- only exposes withWorkspace(), which sets app.workspace_id, and withSystem(), which switches
-- to dmi_system (BYPASSRLS) for the few cross-workspace operations.
--
-- Tables added in later migrations must repeat the block at the end of this file; the test
-- tests/integration/rls.test.ts fails if any workspace table lacks the policy.

GRANT USAGE ON SCHEMA dmi TO dmi_app, dmi_system;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA dmi TO dmi_app, dmi_system;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA dmi GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dmi_app, dmi_system;
--> statement-breakpoint

-- The audit log is append-only (BRD 6.6): no update or delete for any application role.
REVOKE UPDATE, DELETE, TRUNCATE ON dmi.audit_log FROM dmi_app, dmi_system;
--> statement-breakpoint

DO $$
DECLARE
  t record;
  expr text := $e$workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid$e$;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'dmi' AND c.column_name = 'workspace_id' AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE dmi.%I ENABLE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('ALTER TABLE dmi.%I FORCE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('CREATE POLICY workspace_isolation ON dmi.%I USING (%s) WITH CHECK (%s)', t.table_name, expr, expr);
  END LOOP;
END
$$;
--> statement-breakpoint

-- workspaces: a scoped transaction sees only its own workspace row.
ALTER TABLE dmi.workspaces ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dmi.workspaces FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_isolation ON dmi.workspaces
  USING (id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- users: a scoped transaction sees only members of its workspace (workspace_members is itself
-- filtered by the policy above). Creating users happens through withSystem() at sign-in.
ALTER TABLE dmi.users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dmi.users FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_members_only ON dmi.users
  USING (id IN (SELECT user_id FROM dmi.workspace_members))
  WITH CHECK (id IN (SELECT user_id FROM dmi.workspace_members));
