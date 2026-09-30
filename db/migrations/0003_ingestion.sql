ALTER TYPE "dmi"."queue_item_kind" ADD VALUE 'ambiguous_cik';--> statement-breakpoint
CREATE TABLE "dmi"."usage_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"period" text NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	"alerted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_counters_period" CHECK ("dmi"."usage_counters"."period" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "dmi"."feeds" ADD COLUMN "last_success_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dmi"."feeds" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dmi"."usage_counters" ADD CONSTRAINT "usage_counters_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_counters_workspace_id_provider_period_index" ON "dmi"."usage_counters" USING btree ("workspace_id","provider","period");--> statement-breakpoint
-- Tenancy isolation for the new table: the same policy as 0001_rls_and_grants.sql.
ALTER TABLE dmi.usage_counters ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE dmi.usage_counters FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY workspace_isolation ON dmi.usage_counters
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
