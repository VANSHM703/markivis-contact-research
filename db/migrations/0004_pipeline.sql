ALTER TABLE "dmi"."drafts" ADD COLUMN "check_issues" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "dmi"."raw_items" ADD COLUMN "attempts" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dmi"."raw_items" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "dmi"."signals" ADD COLUMN "proposed_changes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "dmi"."signals" ADD COLUMN "explanation" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "dmi"."signals" ADD COLUMN "research_notes" jsonb DEFAULT '[]'::jsonb NOT NULL;