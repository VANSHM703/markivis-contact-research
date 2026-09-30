ALTER TYPE "dmi"."notification_kind" ADD VALUE 'brief';--> statement-breakpoint
ALTER TYPE "dmi"."source_type" ADD VALUE 'crm';--> statement-breakpoint
CREATE TABLE "dmi"."crm_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"crm_id" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dmi"."crm_links" ADD CONSTRAINT "crm_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_links_workspace_id_provider_entity_type_entity_id_index" ON "dmi"."crm_links" USING btree ("workspace_id","provider","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "crm_links_workspace_id_provider_crm_id_index" ON "dmi"."crm_links" USING btree ("workspace_id","provider","crm_id");--> statement-breakpoint
-- Tenancy isolation for the new table: the same policy as 0001_rls_and_grants.sql.
ALTER TABLE dmi.crm_links ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE dmi.crm_links FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY workspace_isolation ON dmi.crm_links
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
