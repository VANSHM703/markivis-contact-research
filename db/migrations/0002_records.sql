-- Trigram name search (BRD 19: search under 300 ms at p95). pg_trgm is a trusted extension,
-- so the database owner can create it. Pinned to public: the owner role is also named dmi, so
-- the default search path would otherwise install it into schema dmi, where the application
-- role's search path does not look.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;--> statement-breakpoint
CREATE TYPE "dmi"."import_kind" AS ENUM('target_list', 'placements', 'off_limits', 'content_library', 'newsletter_events');--> statement-breakpoint
CREATE TYPE "dmi"."import_status" AS ENUM('previewed', 'committed', 'discarded');--> statement-breakpoint
CREATE TABLE "dmi"."import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "dmi"."import_kind" NOT NULL,
	"filename" text NOT NULL,
	"status" "dmi"."import_status" DEFAULT 'previewed' NOT NULL,
	"rows" jsonb NOT NULL,
	"report" jsonb,
	"created_by" uuid NOT NULL,
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dmi"."workspaces" ADD COLUMN "suppression_salt" text DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
ALTER TABLE "dmi"."import_batches" ADD CONSTRAINT "import_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."import_batches" ADD CONSTRAINT "import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "dmi"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_batches_workspace_id_created_at_index" ON "dmi"."import_batches" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "import_batches_created_by_index" ON "dmi"."import_batches" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "companies_name_trgm" ON "dmi"."companies" USING gin ("name_normalised" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "companies_aliases_gin" ON "dmi"."companies" USING gin ("aliases");--> statement-breakpoint
CREATE INDEX "persons_name_trgm" ON "dmi"."persons" USING gin ("name_normalised" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "persons_workspace_id_city_index" ON "dmi"."persons" USING btree ("workspace_id","city");--> statement-breakpoint
-- Tenancy isolation for the new table: the same policy as 0001_rls_and_grants.sql.
ALTER TABLE dmi.import_batches ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE dmi.import_batches FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY workspace_isolation ON dmi.import_batches
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
