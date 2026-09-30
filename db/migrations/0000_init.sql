CREATE SCHEMA "dmi";
--> statement-breakpoint
CREATE TYPE "dmi"."action_outcome" AS ENUM('none', 'no_reply', 'replied', 'meeting', 'mandate');--> statement-breakpoint
CREATE TYPE "dmi"."action_status" AS ENUM('open', 'drafted', 'awaiting_approval', 'approved', 'sent', 'done', 'dismissed', 'expired');--> statement-breakpoint
CREATE TYPE "dmi"."action_type" AS ENUM('congratulate', 'check_in', 'introduction_request', 'invite_interview', 'invite_event', 'share_content', 'pause', 'reengage', 'custom');--> statement-breakpoint
CREATE TYPE "dmi"."actor_kind" AS ENUM('user', 'system', 'platform_admin');--> statement-breakpoint
CREATE TYPE "dmi"."ai_call_status" AS ENUM('ok', 'error');--> statement-breakpoint
CREATE TYPE "dmi"."band" AS ENUM('strong', 'warm', 'cooling', 'cold', 'none');--> statement-breakpoint
CREATE TYPE "dmi"."captured_by" AS ENUM('auto', 'manual', 'import');--> statement-breakpoint
CREATE TYPE "dmi"."channel" AS ENUM('email', 'meeting', 'call', 'linkedin_request', 'linkedin_message', 'event', 'interview', 'newsletter_click', 'newsletter_open', 'download', 'note');--> statement-breakpoint
CREATE TYPE "dmi"."client_status" AS ENUM('client', 'prospect', 'none');--> statement-breakpoint
CREATE TYPE "dmi"."confidence" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "dmi"."connection_type" AS ENUM('shared_board', 'overlapping_tenure', 'reported_to', 'deal_counterpart', 'introduced_by', 'manual_other');--> statement-breakpoint
CREATE TYPE "dmi"."consent_channel" AS ENUM('email', 'newsletter', 'linkedin', 'phone');--> statement-breakpoint
CREATE TYPE "dmi"."consent_purpose" AS ENUM('outreach', 'newsletter');--> statement-breakpoint
CREATE TYPE "dmi"."consent_status" AS ENUM('opted_in', 'opted_out', 'legitimate_interest', 'unknown');--> statement-breakpoint
CREATE TYPE "dmi"."direction" AS ENUM('outbound', 'inbound', 'two_way', 'not_applicable');--> statement-breakpoint
CREATE TYPE "dmi"."dismiss_reason" AS ENUM('not_relevant', 'already_known', 'wrong_timing', 'off_limits');--> statement-breakpoint
CREATE TYPE "dmi"."draft_author" AS ENUM('ai', 'user');--> statement-breakpoint
CREATE TYPE "dmi"."draft_channel" AS ENUM('email', 'linkedin_message');--> statement-breakpoint
CREATE TYPE "dmi"."email_status" AS ENUM('verified', 'guessed', 'invalid', 'unknown');--> statement-breakpoint
CREATE TYPE "dmi"."found_by" AS ENUM('ai_scan', 'apollo', 'feed_rule', 'team_member');--> statement-breakpoint
CREATE TYPE "dmi"."interest_source" AS ENUM('first_party', 'manual', 'ai', 'apollo');--> statement-breakpoint
CREATE TYPE "dmi"."lane" AS ENUM('auto_confirm', 'review', 'weekly_batch', 'more_research');--> statement-breakpoint
CREATE TYPE "dmi"."member_role" AS ENUM('partner', 'outreach_owner', 'validator', 'account_lead', 'data_steward');--> statement-breakpoint
CREATE TYPE "dmi"."member_status" AS ENUM('invited', 'active', 'removed');--> statement-breakpoint
CREATE TYPE "dmi"."oauth_status" AS ENUM('active', 'revoked', 'error');--> statement-breakpoint
CREATE TYPE "dmi"."off_limits_reason" AS ENUM('current_client', 'recent_placement', 'contractual');--> statement-breakpoint
CREATE TYPE "dmi"."off_limits_scope" AS ENUM('company', 'function', 'level_and_above');--> statement-breakpoint
CREATE TYPE "dmi"."ownership_type" AS ENUM('public', 'pe_backed', 'vc_backed', 'private', 'non_profit', 'unknown');--> statement-breakpoint
CREATE TYPE "dmi"."person_status" AS ENUM('active', 'no_current_role', 'do_not_contact');--> statement-breakpoint
CREATE TYPE "dmi"."queue_item_kind" AS ENUM('data_conflict', 'possible_duplicate');--> statement-breakpoint
CREATE TYPE "dmi"."queue_item_status" AS ENUM('pending', 'resolved');--> statement-breakpoint
CREATE TYPE "dmi"."raw_item_outcome" AS ENUM('irrelevant', 'signal_created', 'signal_merged', 'record_updated', 'error');--> statement-breakpoint
CREATE TYPE "dmi"."reject_reason" AS ENUM('wrong_person', 'not_a_change', 'duplicate', 'out_of_date', 'not_relevant');--> statement-breakpoint
CREATE TYPE "dmi"."role_status" AS ENUM('announced', 'current', 'ended');--> statement-breakpoint
CREATE TYPE "dmi"."seat_type" AS ENUM('executive', 'board', 'advisory', 'pe_operating_partner', 'pe_deal_partner', 'other');--> statement-breakpoint
CREATE TYPE "dmi"."secret_kind" AS ENUM('apollo_api_key', 'hubspot_private_app_token', 'newsletter_api_key');--> statement-breakpoint
CREATE TYPE "dmi"."seniority" AS ENUM('c_suite', 'board', 'svp', 'vp', 'other');--> statement-breakpoint
CREATE TYPE "dmi"."signal_status" AS ENUM('pending', 'confirmed', 'rejected', 'needs_info', 'parked', 'shadow');--> statement-breakpoint
CREATE TYPE "dmi"."signal_type" AS ENUM('person_move_announced', 'person_left', 'person_joined', 'person_board_change', 'company_cxo_change', 'company_pe_transaction', 'company_mna', 'company_funding_ipo', 'person_promotion', 'person_speaking', 'person_email_bounced', 'company_layoffs', 'company_expansion', 'company_hiring_surge', 'internal_relationship_quiet', 'person_award', 'person_content_engagement', 'company_ceo_tenure_threshold', 'company_product_partnership', 'company_intent_spike', 'other');--> statement-breakpoint
CREATE TYPE "dmi"."size_band" AS ENUM('lt_200', '200_999', '1000_4999', '5000_plus', 'unknown');--> statement-breakpoint
CREATE TYPE "dmi"."source_type" AS ENUM('apollo', 'sec_8k', 'press_wire', 'google_alert', 'leadership_page', 'newsletter', 'event_site', 'manual', 'ai_research', 'licensed', 'news_api', 'warn', 'job_postings');--> statement-breakpoint
CREATE TYPE "dmi"."spot_check_result" AS ENUM('correct', 'incorrect');--> statement-breakpoint
CREATE TYPE "dmi"."subject_type" AS ENUM('person', 'company');--> statement-breakpoint
CREATE TYPE "dmi"."suppression_kind" AS ENUM('email', 'linkedin');--> statement-breakpoint
CREATE TYPE "dmi"."suppression_reason" AS ENUM('erasure', 'opt_out', 'do_not_contact');--> statement-breakpoint
CREATE TABLE "dmi"."actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"signal_id" uuid,
	"person_id" uuid,
	"company_id" uuid,
	"type" "dmi"."action_type" NOT NULL,
	"status" "dmi"."action_status" DEFAULT 'open' NOT NULL,
	"headline" text,
	"owner_user_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"best_path" jsonb,
	"why_it_matters" text,
	"dismiss_reason" "dmi"."dismiss_reason",
	"blocked_reason" text,
	"outcome" "dmi"."action_outcome" DEFAULT 'none' NOT NULL,
	"outcome_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "actions_subject_present" CHECK ("dmi"."actions"."person_id" is not null or "dmi"."actions"."company_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "dmi"."ai_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(10, 4),
	"latency_ms" integer,
	"status" "dmi"."ai_call_status" NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dmi"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"actor_user_id" uuid,
	"actor_kind" "dmi"."actor_kind" NOT NULL,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"user_agent" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dmi"."briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"calendar_event_id" uuid,
	"content_markdown" text NOT NULL,
	"model" text,
	"prompt_version" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dmi"."calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"title" text,
	"attendee_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"person_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"brief_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dmi"."capture_exclusions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"pattern" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dmi"."companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_normalised" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"domain" text,
	"sec_cik" text,
	"ownership" "dmi"."ownership_type" DEFAULT 'unknown' NOT NULL,
	"is_sponsor" boolean DEFAULT false NOT NULL,
	"hq_country" text,
	"hq_region" text,
	"industry" text,
	"employee_count" integer,
	"size_band" "dmi"."size_band" DEFAULT 'unknown' NOT NULL,
	"target_tier" smallint,
	"client_status" "dmi"."client_status" DEFAULT 'none' NOT NULL,
	"apollo_org_id" text,
	"intent_topics" jsonb,
	"leadership_page_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_target_tier" CHECK ("dmi"."companies"."target_tier" is null or "dmi"."companies"."target_tier" in (1, 2, 3)),
	CONSTRAINT "companies_sec_cik_format" CHECK ("dmi"."companies"."sec_cik" is null or "dmi"."companies"."sec_cik" ~ '^[0-9]{10}$')
);
--> statement-breakpoint
CREATE TABLE "dmi"."connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"person_a_id" uuid NOT NULL,
	"person_b_id" uuid NOT NULL,
	"type" "dmi"."connection_type" NOT NULL,
	"company_id" uuid,
	"period_start" date,
	"period_end" date,
	"weight" numeric(3, 2) NOT NULL,
	"derived" boolean NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connections_personAId_personBId_type_companyId_unique" UNIQUE NULLS NOT DISTINCT("person_a_id","person_b_id","type","company_id"),
	CONSTRAINT "connections_ordered_pair" CHECK ("dmi"."connections"."person_a_id" < "dmi"."connections"."person_b_id"),
	CONSTRAINT "connections_weight_range" CHECK ("dmi"."connections"."weight" >= 0 and "dmi"."connections"."weight" <= 1)
);
--> statement-breakpoint
CREATE TABLE "dmi"."consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"channel" "dmi"."consent_channel" NOT NULL,
	"purpose" "dmi"."consent_purpose" NOT NULL,
	"status" "dmi"."consent_status" NOT NULL,
	"jurisdiction" text,
	"captured_via" text,
	"proof" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dmi"."content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"description" text,
	"topics" text[] DEFAULT '{}'::text[] NOT NULL,
	"published_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dmi"."drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"channel" "dmi"."draft_channel" NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"author" "dmi"."draft_author" NOT NULL,
	"model" text,
	"prompt_version" text,
	"content_item_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"provider_message_id" text,
	"send_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dmi"."feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_type" "dmi"."source_type" NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dmi"."field_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"field" text NOT NULL,
	"value" text,
	"source_type" "dmi"."source_type" NOT NULL,
	"source_url" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone,
	"confidence" "dmi"."confidence" NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"in_conflict" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_sources_entity_type" CHECK ("dmi"."field_sources"."entity_type" in ('person', 'company', 'role'))
);
--> statement-breakpoint
CREATE TABLE "dmi"."interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role_id" uuid,
	"channel" "dmi"."channel" NOT NULL,
	"direction" "dmi"."direction" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"our_user_id" uuid,
	"subject" text,
	"summary" text,
	"thread_key" text,
	"provider" text NOT NULL,
	"external_id" text,
	"captured_by" "dmi"."captured_by" NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"content_topic" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dmi"."mandate_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"person_id" uuid,
	"company_id" uuid,
	"body" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mandate_notes_subject" CHECK ("dmi"."mandate_notes"."person_id" is not null or "dmi"."mandate_notes"."company_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "dmi"."oauth_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"token_ciphertext" "bytea",
	"token_key_id" text,
	"status" "dmi"."oauth_status" DEFAULT 'active' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"delta_cursor" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dmi"."off_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"scope" "dmi"."off_limits_scope" NOT NULL,
	"function" text,
	"min_seniority" "dmi"."seniority",
	"reason" "dmi"."off_limits_reason" NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"set_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dmi"."person_interests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"source" "dmi"."interest_source" NOT NULL,
	"source_url" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dmi"."persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"preferred_name" text,
	"name_normalised" text NOT NULL,
	"linkedin_url" text,
	"city" text,
	"region" text,
	"country" text,
	"contact_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"relationship_owner_id" uuid,
	"status" "dmi"."person_status" DEFAULT 'active' NOT NULL,
	"is_tracked" boolean DEFAULT true NOT NULL,
	"is_off_list" boolean DEFAULT false NOT NULL,
	"is_priority" boolean DEFAULT false NOT NULL,
	"merged_into_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persons_country_iso2" CHECK ("dmi"."persons"."country" is null or "dmi"."persons"."country" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "dmi"."placements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"role_title" text NOT NULL,
	"placed_on" date NOT NULL,
	"search_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dmi"."queue_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "dmi"."queue_item_kind" NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "dmi"."queue_item_status" DEFAULT 'pending' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dmi"."raw_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_type" "dmi"."source_type" NOT NULL,
	"feed_id" uuid,
	"external_id" text NOT NULL,
	"url" text,
	"title" text,
	"body_text" text,
	"published_at" timestamp with time zone,
	"payload" jsonb,
	"processed_at" timestamp with time zone,
	"outcome" "dmi"."raw_item_outcome",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raw_items_body_max" CHECK ("dmi"."raw_items"."body_text" is null or char_length("dmi"."raw_items"."body_text") <= 50000)
);
--> statement-breakpoint
CREATE TABLE "dmi"."relationship_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"user_id" uuid,
	"score" smallint NOT NULL,
	"band" "dmi"."band" NOT NULL,
	"factors" jsonb NOT NULL,
	"last_two_way_at" timestamp with time zone,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relationship_scores_key" UNIQUE NULLS NOT DISTINCT("workspace_id","person_id","user_id"),
	CONSTRAINT "relationship_scores_range" CHECK ("dmi"."relationship_scores"."score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "dmi"."roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"seat_type" "dmi"."seat_type" NOT NULL,
	"title" text NOT NULL,
	"title_normalised" text,
	"function" text,
	"seniority" "dmi"."seniority" DEFAULT 'other' NOT NULL,
	"business_email" text,
	"email_status" "dmi"."email_status" DEFAULT 'unknown' NOT NULL,
	"announced_on" date,
	"effective_on" date,
	"ended_on" date,
	"status" "dmi"."role_status" NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_personId_companyId_titleNormalised_effectiveOn_unique" UNIQUE NULLS NOT DISTINCT("person_id","company_id","title_normalised","effective_on"),
	CONSTRAINT "roles_email_lowercase" CHECK ("dmi"."roles"."business_email" is null or "dmi"."roles"."business_email" = lower("dmi"."roles"."business_email"))
);
--> statement-breakpoint
CREATE TABLE "dmi"."signal_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"raw_item_id" uuid,
	"source_type" "dmi"."source_type" NOT NULL,
	"url" text,
	"title" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dmi"."signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"subject_type" "dmi"."subject_type" NOT NULL,
	"person_id" uuid,
	"company_id" uuid,
	"role_id" uuid,
	"type" "dmi"."signal_type" NOT NULL,
	"headline" text NOT NULL,
	"evidence" text,
	"event_on" date,
	"announced_on" date,
	"effective_on" date,
	"found_at" timestamp with time zone DEFAULT now() NOT NULL,
	"found_by" "dmi"."found_by" NOT NULL,
	"match_score" numeric(3, 2),
	"confidence" "dmi"."confidence" NOT NULL,
	"priority" smallint NOT NULL,
	"lane" "dmi"."lane" NOT NULL,
	"status" "dmi"."signal_status" NOT NULL,
	"research_cycles" smallint DEFAULT 0 NOT NULL,
	"dedupe_key" text NOT NULL,
	"merged_into_id" uuid,
	"validated_by" uuid,
	"validated_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"reject_reason" "dmi"."reject_reason",
	"is_spot_check" boolean DEFAULT false NOT NULL,
	"spot_check_result" "dmi"."spot_check_result",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signals_subject_present" CHECK ("dmi"."signals"."person_id" is not null or "dmi"."signals"."company_id" is not null),
	CONSTRAINT "signals_priority_range" CHECK ("dmi"."signals"."priority" in (1, 2, 3)),
	CONSTRAINT "signals_headline_max" CHECK (char_length("dmi"."signals"."headline") <= 140),
	CONSTRAINT "signals_evidence_max" CHECK ("dmi"."signals"."evidence" is null or char_length("dmi"."signals"."evidence") <= 300),
	CONSTRAINT "signals_research_cycles_max" CHECK ("dmi"."signals"."research_cycles" between 0 and 2),
	CONSTRAINT "signals_match_score_range" CHECK ("dmi"."signals"."match_score" is null or ("dmi"."signals"."match_score" >= 0 and "dmi"."signals"."match_score" <= 1))
);
--> statement-breakpoint
CREATE TABLE "dmi"."source_stats_weekly" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"feed_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"raw_items" integer DEFAULT 0 NOT NULL,
	"signals_created" integer DEFAULT 0 NOT NULL,
	"confirmed" integer DEFAULT 0 NOT NULL,
	"rejected" integer DEFAULT 0 NOT NULL,
	"auto_confirmed" integer DEFAULT 0 NOT NULL,
	"spot_check_errors" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dmi"."sponsor_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sponsor_company_id" uuid NOT NULL,
	"portfolio_company_id" uuid NOT NULL,
	"deal_type" text,
	"acquired_on" date,
	"exited_on" date,
	"deal_partner_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dmi"."suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"hash" text NOT NULL,
	"kind" "dmi"."suppression_kind" NOT NULL,
	"reason" "dmi"."suppression_reason" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dmi"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"last_sign_in_at" timestamp with time zone,
	"last_amr" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "dmi"."workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "dmi"."member_role" NOT NULL,
	"invited_by" uuid,
	"status" "dmi"."member_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dmi"."workspace_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "dmi"."secret_kind" NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"key_id" text NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dmi"."workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"packs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"allowed_email_domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "dmi"."actions" ADD CONSTRAINT "actions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."actions" ADD CONSTRAINT "actions_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "dmi"."signals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."actions" ADD CONSTRAINT "actions_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "dmi"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."actions" ADD CONSTRAINT "actions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "dmi"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."actions" ADD CONSTRAINT "actions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "dmi"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."ai_calls" ADD CONSTRAINT "ai_calls_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."audit_log" ADD CONSTRAINT "audit_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "dmi"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."briefs" ADD CONSTRAINT "briefs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."briefs" ADD CONSTRAINT "briefs_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "dmi"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."briefs" ADD CONSTRAINT "briefs_calendar_event_id_calendar_events_id_fk" FOREIGN KEY ("calendar_event_id") REFERENCES "dmi"."calendar_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."calendar_events" ADD CONSTRAINT "calendar_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."calendar_events" ADD CONSTRAINT "calendar_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "dmi"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."calendar_events" ADD CONSTRAINT "calendar_events_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "dmi"."briefs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."capture_exclusions" ADD CONSTRAINT "capture_exclusions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."capture_exclusions" ADD CONSTRAINT "capture_exclusions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "dmi"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."companies" ADD CONSTRAINT "companies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."connections" ADD CONSTRAINT "connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."connections" ADD CONSTRAINT "connections_person_a_id_persons_id_fk" FOREIGN KEY ("person_a_id") REFERENCES "dmi"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."connections" ADD CONSTRAINT "connections_person_b_id_persons_id_fk" FOREIGN KEY ("person_b_id") REFERENCES "dmi"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."connections" ADD CONSTRAINT "connections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "dmi"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."consents" ADD CONSTRAINT "consents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."consents" ADD CONSTRAINT "consents_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "dmi"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."consents" ADD CONSTRAINT "consents_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "dmi"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."content_items" ADD CONSTRAINT "content_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."drafts" ADD CONSTRAINT "drafts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."drafts" ADD CONSTRAINT "drafts_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "dmi"."actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."drafts" ADD CONSTRAINT "drafts_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "dmi"."content_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."drafts" ADD CONSTRAINT "drafts_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "dmi"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."feeds" ADD CONSTRAINT "feeds_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."field_sources" ADD CONSTRAINT "field_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."interactions" ADD CONSTRAINT "interactions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."interactions" ADD CONSTRAINT "interactions_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "dmi"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."interactions" ADD CONSTRAINT "interactions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "dmi"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."interactions" ADD CONSTRAINT "interactions_our_user_id_users_id_fk" FOREIGN KEY ("our_user_id") REFERENCES "dmi"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."mandate_notes" ADD CONSTRAINT "mandate_notes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."mandate_notes" ADD CONSTRAINT "mandate_notes_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "dmi"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."mandate_notes" ADD CONSTRAINT "mandate_notes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "dmi"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."mandate_notes" ADD CONSTRAINT "mandate_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "dmi"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."oauth_connections" ADD CONSTRAINT "oauth_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."oauth_connections" ADD CONSTRAINT "oauth_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "dmi"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."off_limits" ADD CONSTRAINT "off_limits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."off_limits" ADD CONSTRAINT "off_limits_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "dmi"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."off_limits" ADD CONSTRAINT "off_limits_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "dmi"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."person_interests" ADD CONSTRAINT "person_interests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."person_interests" ADD CONSTRAINT "person_interests_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "dmi"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."persons" ADD CONSTRAINT "persons_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."persons" ADD CONSTRAINT "persons_relationship_owner_id_users_id_fk" FOREIGN KEY ("relationship_owner_id") REFERENCES "dmi"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."persons" ADD CONSTRAINT "persons_merged_into_id_persons_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "dmi"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."placements" ADD CONSTRAINT "placements_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."placements" ADD CONSTRAINT "placements_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "dmi"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."placements" ADD CONSTRAINT "placements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "dmi"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."queue_items" ADD CONSTRAINT "queue_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."queue_items" ADD CONSTRAINT "queue_items_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "dmi"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."raw_items" ADD CONSTRAINT "raw_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."raw_items" ADD CONSTRAINT "raw_items_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "dmi"."feeds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."relationship_scores" ADD CONSTRAINT "relationship_scores_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."relationship_scores" ADD CONSTRAINT "relationship_scores_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "dmi"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."relationship_scores" ADD CONSTRAINT "relationship_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "dmi"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."roles" ADD CONSTRAINT "roles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."roles" ADD CONSTRAINT "roles_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "dmi"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."roles" ADD CONSTRAINT "roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "dmi"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."signal_sources" ADD CONSTRAINT "signal_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."signal_sources" ADD CONSTRAINT "signal_sources_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "dmi"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."signal_sources" ADD CONSTRAINT "signal_sources_raw_item_id_raw_items_id_fk" FOREIGN KEY ("raw_item_id") REFERENCES "dmi"."raw_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."signals" ADD CONSTRAINT "signals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."signals" ADD CONSTRAINT "signals_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "dmi"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."signals" ADD CONSTRAINT "signals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "dmi"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."signals" ADD CONSTRAINT "signals_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "dmi"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."signals" ADD CONSTRAINT "signals_merged_into_id_signals_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "dmi"."signals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."signals" ADD CONSTRAINT "signals_validated_by_users_id_fk" FOREIGN KEY ("validated_by") REFERENCES "dmi"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."source_stats_weekly" ADD CONSTRAINT "source_stats_weekly_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."source_stats_weekly" ADD CONSTRAINT "source_stats_weekly_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "dmi"."feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."sponsor_links" ADD CONSTRAINT "sponsor_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."sponsor_links" ADD CONSTRAINT "sponsor_links_sponsor_company_id_companies_id_fk" FOREIGN KEY ("sponsor_company_id") REFERENCES "dmi"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."sponsor_links" ADD CONSTRAINT "sponsor_links_portfolio_company_id_companies_id_fk" FOREIGN KEY ("portfolio_company_id") REFERENCES "dmi"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."sponsor_links" ADD CONSTRAINT "sponsor_links_deal_partner_person_id_persons_id_fk" FOREIGN KEY ("deal_partner_person_id") REFERENCES "dmi"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."suppressions" ADD CONSTRAINT "suppressions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "dmi"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."workspace_members" ADD CONSTRAINT "workspace_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "dmi"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."workspace_secrets" ADD CONSTRAINT "workspace_secrets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "dmi"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmi"."workspace_secrets" ADD CONSTRAINT "workspace_secrets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "dmi"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actions_workspace_id_owner_user_id_status_due_at_index" ON "dmi"."actions" USING btree ("workspace_id","owner_user_id","status","due_at");--> statement-breakpoint
CREATE INDEX "actions_signal_id_index" ON "dmi"."actions" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "actions_person_id_index" ON "dmi"."actions" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "actions_company_id_index" ON "dmi"."actions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "ai_calls_workspace_id_created_at_index" ON "dmi"."ai_calls" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_workspace_id_at_index" ON "dmi"."audit_log" USING btree ("workspace_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_workspace_id_entity_type_entity_id_index" ON "dmi"."audit_log" USING btree ("workspace_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_user_id_index" ON "dmi"."audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "briefs_person_id_index" ON "dmi"."briefs" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "briefs_calendar_event_id_index" ON "dmi"."briefs" USING btree ("calendar_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_workspace_id_provider_external_id_index" ON "dmi"."calendar_events" USING btree ("workspace_id","provider","external_id");--> statement-breakpoint
CREATE INDEX "calendar_events_user_id_starts_at_index" ON "dmi"."calendar_events" USING btree ("user_id","starts_at");--> statement-breakpoint
CREATE INDEX "calendar_events_brief_id_index" ON "dmi"."calendar_events" USING btree ("brief_id");--> statement-breakpoint
CREATE UNIQUE INDEX "capture_exclusions_workspace_id_user_id_pattern_index" ON "dmi"."capture_exclusions" USING btree ("workspace_id","user_id","pattern");--> statement-breakpoint
CREATE INDEX "companies_workspace_id_domain_index" ON "dmi"."companies" USING btree ("workspace_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_workspace_domain_unique" ON "dmi"."companies" USING btree ("workspace_id","domain") WHERE "dmi"."companies"."domain" is not null;--> statement-breakpoint
CREATE INDEX "companies_workspace_id_sec_cik_index" ON "dmi"."companies" USING btree ("workspace_id","sec_cik");--> statement-breakpoint
CREATE INDEX "companies_workspace_id_name_normalised_index" ON "dmi"."companies" USING btree ("workspace_id","name_normalised");--> statement-breakpoint
CREATE INDEX "connections_person_b_id_index" ON "dmi"."connections" USING btree ("person_b_id");--> statement-breakpoint
CREATE INDEX "connections_company_id_index" ON "dmi"."connections" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consents_person_id_channel_purpose_index" ON "dmi"."consents" USING btree ("person_id","channel","purpose");--> statement-breakpoint
CREATE INDEX "consents_recorded_by_index" ON "dmi"."consents" USING btree ("recorded_by");--> statement-breakpoint
CREATE INDEX "content_items_workspace_id_published_on_index" ON "dmi"."content_items" USING btree ("workspace_id","published_on");--> statement-breakpoint
CREATE UNIQUE INDEX "drafts_action_id_version_index" ON "dmi"."drafts" USING btree ("action_id","version");--> statement-breakpoint
CREATE INDEX "drafts_content_item_id_index" ON "dmi"."drafts" USING btree ("content_item_id");--> statement-breakpoint
CREATE INDEX "drafts_approved_by_index" ON "dmi"."drafts" USING btree ("approved_by");--> statement-breakpoint
CREATE INDEX "feeds_workspace_id_source_type_index" ON "dmi"."feeds" USING btree ("workspace_id","source_type");--> statement-breakpoint
CREATE INDEX "field_sources_workspace_id_entity_type_entity_id_field_index" ON "dmi"."field_sources" USING btree ("workspace_id","entity_type","entity_id","field");--> statement-breakpoint
CREATE INDEX "interactions_workspace_id_person_id_occurred_at_index" ON "dmi"."interactions" USING btree ("workspace_id","person_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "interactions_workspace_id_provider_external_id_index" ON "dmi"."interactions" USING btree ("workspace_id","provider","external_id");--> statement-breakpoint
CREATE INDEX "interactions_role_id_index" ON "dmi"."interactions" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "interactions_our_user_id_index" ON "dmi"."interactions" USING btree ("our_user_id");--> statement-breakpoint
CREATE INDEX "interactions_workspace_id_thread_key_index" ON "dmi"."interactions" USING btree ("workspace_id","thread_key");--> statement-breakpoint
CREATE INDEX "mandate_notes_person_id_index" ON "dmi"."mandate_notes" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "mandate_notes_company_id_index" ON "dmi"."mandate_notes" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "mandate_notes_created_by_index" ON "dmi"."mandate_notes" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_connections_workspace_id_user_id_provider_index" ON "dmi"."oauth_connections" USING btree ("workspace_id","user_id","provider");--> statement-breakpoint
CREATE INDEX "off_limits_company_id_index" ON "dmi"."off_limits" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "off_limits_set_by_index" ON "dmi"."off_limits" USING btree ("set_by");--> statement-breakpoint
CREATE UNIQUE INDEX "person_interests_person_id_topic_source_index" ON "dmi"."person_interests" USING btree ("person_id","topic","source");--> statement-breakpoint
CREATE INDEX "persons_workspace_id_name_normalised_index" ON "dmi"."persons" USING btree ("workspace_id","name_normalised");--> statement-breakpoint
CREATE INDEX "persons_workspace_id_linkedin_url_index" ON "dmi"."persons" USING btree ("workspace_id","linkedin_url");--> statement-breakpoint
CREATE UNIQUE INDEX "persons_workspace_linkedin_unique" ON "dmi"."persons" USING btree ("workspace_id","linkedin_url") WHERE "dmi"."persons"."linkedin_url" is not null;--> statement-breakpoint
CREATE INDEX "persons_relationship_owner_id_index" ON "dmi"."persons" USING btree ("relationship_owner_id");--> statement-breakpoint
CREATE INDEX "persons_merged_into_id_index" ON "dmi"."persons" USING btree ("merged_into_id");--> statement-breakpoint
CREATE INDEX "placements_person_id_index" ON "dmi"."placements" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "placements_company_id_index" ON "dmi"."placements" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "queue_items_workspace_id_status_created_at_index" ON "dmi"."queue_items" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE INDEX "queue_items_resolved_by_index" ON "dmi"."queue_items" USING btree ("resolved_by");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_items_workspace_id_source_type_external_id_index" ON "dmi"."raw_items" USING btree ("workspace_id","source_type","external_id");--> statement-breakpoint
CREATE INDEX "raw_items_feed_id_index" ON "dmi"."raw_items" USING btree ("feed_id");--> statement-breakpoint
CREATE INDEX "raw_items_workspace_id_processed_at_index" ON "dmi"."raw_items" USING btree ("workspace_id","processed_at");--> statement-breakpoint
CREATE INDEX "relationship_scores_person_id_index" ON "dmi"."relationship_scores" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "relationship_scores_user_id_index" ON "dmi"."relationship_scores" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_one_primary_per_person" ON "dmi"."roles" USING btree ("person_id") WHERE "dmi"."roles"."is_primary";--> statement-breakpoint
CREATE INDEX "roles_workspace_id_business_email_index" ON "dmi"."roles" USING btree ("workspace_id","business_email");--> statement-breakpoint
CREATE INDEX "roles_person_id_status_index" ON "dmi"."roles" USING btree ("person_id","status");--> statement-breakpoint
CREATE INDEX "roles_company_id_index" ON "dmi"."roles" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "signal_sources_signal_id_index" ON "dmi"."signal_sources" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "signal_sources_raw_item_id_index" ON "dmi"."signal_sources" USING btree ("raw_item_id");--> statement-breakpoint
CREATE INDEX "signals_workspace_id_status_priority_found_at_index" ON "dmi"."signals" USING btree ("workspace_id","status","priority","found_at");--> statement-breakpoint
CREATE INDEX "signals_workspace_id_dedupe_key_index" ON "dmi"."signals" USING btree ("workspace_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "signals_person_id_index" ON "dmi"."signals" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "signals_company_id_index" ON "dmi"."signals" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "signals_role_id_index" ON "dmi"."signals" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "signals_merged_into_id_index" ON "dmi"."signals" USING btree ("merged_into_id");--> statement-breakpoint
CREATE INDEX "signals_validated_by_index" ON "dmi"."signals" USING btree ("validated_by");--> statement-breakpoint
CREATE UNIQUE INDEX "source_stats_weekly_feed_id_week_start_index" ON "dmi"."source_stats_weekly" USING btree ("feed_id","week_start");--> statement-breakpoint
CREATE INDEX "sponsor_links_sponsor_company_id_index" ON "dmi"."sponsor_links" USING btree ("sponsor_company_id");--> statement-breakpoint
CREATE INDEX "sponsor_links_portfolio_company_id_index" ON "dmi"."sponsor_links" USING btree ("portfolio_company_id");--> statement-breakpoint
CREATE INDEX "sponsor_links_deal_partner_person_id_index" ON "dmi"."sponsor_links" USING btree ("deal_partner_person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_workspace_id_kind_hash_index" ON "dmi"."suppressions" USING btree ("workspace_id","kind","hash");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_index" ON "dmi"."workspace_members" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_members_user_id_index" ON "dmi"."workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspace_members_invited_by_index" ON "dmi"."workspace_members" USING btree ("invited_by");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_secrets_workspace_id_kind_index" ON "dmi"."workspace_secrets" USING btree ("workspace_id","kind");