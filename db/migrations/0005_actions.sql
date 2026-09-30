CREATE TYPE "dmi"."action_purpose" AS ENUM('client', 'candidate');--> statement-breakpoint
CREATE TYPE "dmi"."notification_kind" AS ENUM('digest', 'p1_change', 'auto_confirm_suspended', 'budget_80');--> statement-breakpoint
CREATE TYPE "dmi"."notification_status" AS ENUM('queued', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "dmi"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"kind" "dmi"."notification_kind" NOT NULL,
	"dedupe_key" text NOT NULL,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"status" "dmi"."notification_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"provider_message_id" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dmi"."actions" ADD COLUMN "purpose" "dmi"."action_purpose" DEFAULT 'client' NOT NULL;--> statement-breakpoint
ALTER TABLE "dmi"."actions" ADD COLUMN "merged_signal_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "dmi"."actions" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dmi"."drafts" ADD COLUMN "sent_from_user_id" uuid;--> statement-breakpoint
ALTER TABLE "dmi"."drafts" ADD COLUMN "rationale" text;--> statement-breakpoint
ALTER TABLE "dmi"."notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "dmi"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_workspace_id_dedupe_key_index" ON "dmi"."notifications" USING btree ("workspace_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_workspace_id_status_created_at_index" ON "dmi"."notifications" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_id_kind_created_at_index" ON "dmi"."notifications" USING btree ("user_id","kind","created_at");--> statement-breakpoint
ALTER TABLE "dmi"."drafts" ADD CONSTRAINT "drafts_sent_from_user_id_users_id_fk" FOREIGN KEY ("sent_from_user_id") REFERENCES "dmi"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drafts_sent_from_user_id_sent_at_index" ON "dmi"."drafts" USING btree ("sent_from_user_id","sent_at");--> statement-breakpoint
-- Tenancy isolation for the new table: the same policy as 0001_rls_and_grants.sql.
ALTER TABLE dmi.notifications ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE dmi.notifications FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY workspace_isolation ON dmi.notifications
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
