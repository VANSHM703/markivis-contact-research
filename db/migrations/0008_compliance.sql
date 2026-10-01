ALTER TYPE "dmi"."dismiss_reason" ADD VALUE 'do_not_contact';--> statement-breakpoint
ALTER TYPE "dmi"."notification_kind" ADD VALUE 'break_glass';--> statement-breakpoint
ALTER TYPE "dmi"."notification_kind" ADD VALUE 'invitation';--> statement-breakpoint
ALTER TYPE "dmi"."notification_kind" ADD VALUE 'retention_review';--> statement-breakpoint
CREATE TABLE "dmi"."break_glass_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "break_glass_reason_length" CHECK (char_length("dmi"."break_glass_grants"."reason") between 10 and 500)
);
--> statement-breakpoint
ALTER TABLE "dmi"."persons" ADD COLUMN "retention_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dmi"."break_glass_grants" ADD CONSTRAINT "break_glass_grants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."break_glass_grants" ADD CONSTRAINT "break_glass_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "dmi"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "break_glass_grants_user_id_expires_at_index" ON "dmi"."break_glass_grants" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "break_glass_grants_workspace_id_created_at_index" ON "dmi"."break_glass_grants" USING btree ("workspace_id","created_at");--> statement-breakpoint
-- Tenancy isolation for the new table (see 0001_rls_and_grants.sql).
ALTER TABLE dmi.break_glass_grants ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE dmi.break_glass_grants FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY workspace_isolation ON dmi.break_glass_grants
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
-- Erasure (BRD 18.2) and the append-only audit log (BRD 6.6, 18.3). The app roles have no UPDATE
-- or DELETE on audit_log. This one function, owned by the migration role, is the only way to
-- change it: it replaces the before and after values of entries about the erased records with a
-- redaction marker, keeping who did what and when. It cannot be pointed at another workspace.
CREATE OR REPLACE FUNCTION dmi.redact_audit(entity_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dmi, pg_temp
AS $$
DECLARE
  ws uuid := nullif(current_setting('app.workspace_id', true), '')::uuid;
  changed integer;
BEGIN
  IF ws IS NULL THEN
    RAISE EXCEPTION 'redact_audit needs a workspace scope';
  END IF;
  UPDATE dmi.audit_log
     SET before = CASE WHEN before IS NULL THEN NULL ELSE '{"redacted": true}'::jsonb END,
         after = CASE WHEN after IS NULL THEN NULL ELSE '{"redacted": true}'::jsonb END
   WHERE workspace_id = ws AND entity_id = ANY(entity_ids) AND (before IS NOT NULL OR after IS NOT NULL);
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION dmi.redact_audit(uuid[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dmi.redact_audit(uuid[]) TO dmi_app, dmi_system;
