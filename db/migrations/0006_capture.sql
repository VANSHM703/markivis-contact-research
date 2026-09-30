CREATE TYPE "dmi"."privacy_mark_kind" AS ENUM('thread', 'person');--> statement-breakpoint
CREATE TABLE "dmi"."privacy_marks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "dmi"."privacy_mark_kind" NOT NULL,
	"key" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dmi"."oauth_connections" ADD COLUMN "account_email" text;--> statement-breakpoint
ALTER TABLE "dmi"."oauth_connections" ADD COLUMN "calendar_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dmi"."privacy_marks" ADD CONSTRAINT "privacy_marks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."privacy_marks" ADD CONSTRAINT "privacy_marks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "dmi"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_marks_workspace_id_kind_key_index" ON "dmi"."privacy_marks" USING btree ("workspace_id","kind","key");--> statement-breakpoint
-- Tenancy isolation for the new table: the same policy as 0001_rls_and_grants.sql.
ALTER TABLE dmi.privacy_marks ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE dmi.privacy_marks FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY workspace_isolation ON dmi.privacy_marks
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
