/**
 * Database schema, BRD section 6. Every table lives in PostgreSQL schema `dmi`.
 * Column names are snake_case in the database (Drizzle `casing: "snake_case"`).
 * Enums are PostgreSQL enums throughout (BRD 6: "choose one approach and use it everywhere").
 * Row-level security is added by the hand-written migration in db/migrations (see src/db/rls.sql).
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const dmi = pgSchema("dmi");

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

// ---------------------------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------------------------

export const memberRole = dmi.enum("member_role", ["partner", "outreach_owner", "validator", "account_lead", "data_steward"]);
export const memberStatus = dmi.enum("member_status", ["invited", "active", "removed"]);
export const personStatus = dmi.enum("person_status", ["active", "no_current_role", "do_not_contact"]);
export const ownershipType = dmi.enum("ownership_type", ["public", "pe_backed", "vc_backed", "private", "non_profit", "unknown"]);
export const sizeBand = dmi.enum("size_band", ["lt_200", "200_999", "1000_4999", "5000_plus", "unknown"]);
export const clientStatus = dmi.enum("client_status", ["client", "prospect", "none"]);
export const seatType = dmi.enum("seat_type", ["executive", "board", "advisory", "pe_operating_partner", "pe_deal_partner", "other"]);
export const seniority = dmi.enum("seniority", ["c_suite", "board", "svp", "vp", "other"]);
export const emailStatus = dmi.enum("email_status", ["verified", "guessed", "invalid", "unknown"]);
export const roleStatus = dmi.enum("role_status", ["announced", "current", "ended"]);
export const connectionType = dmi.enum("connection_type", [
  "shared_board", "overlapping_tenure", "reported_to", "deal_counterpart", "introduced_by", "manual_other",
]);
export const channel = dmi.enum("channel", [
  "email", "meeting", "call", "linkedin_request", "linkedin_message", "event", "interview",
  "newsletter_click", "newsletter_open", "download", "note",
]);
export const direction = dmi.enum("direction", ["outbound", "inbound", "two_way", "not_applicable"]);
export const capturedBy = dmi.enum("captured_by", ["auto", "manual", "import"]);
export const oauthStatus = dmi.enum("oauth_status", ["active", "revoked", "error"]);
export const sourceType = dmi.enum("source_type", [
  "apollo", "sec_8k", "press_wire", "google_alert", "leadership_page", "newsletter", "event_site",
  "manual", "ai_research", "licensed", "news_api", "warn", "job_postings",
]);
export const rawItemOutcome = dmi.enum("raw_item_outcome", ["irrelevant", "signal_created", "signal_merged", "record_updated", "error"]);
export const subjectType = dmi.enum("subject_type", ["person", "company"]);
export const signalType = dmi.enum("signal_type", [
  "person_move_announced", "person_left", "person_joined", "person_board_change", "company_cxo_change",
  "company_pe_transaction", "company_mna", "company_funding_ipo", "person_promotion", "person_speaking",
  "person_email_bounced", "company_layoffs", "company_expansion", "company_hiring_surge",
  "internal_relationship_quiet", "person_award", "person_content_engagement", "company_ceo_tenure_threshold",
  "company_product_partnership", "company_intent_spike", "other",
]);
export const foundBy = dmi.enum("found_by", ["ai_scan", "apollo", "feed_rule", "team_member"]);
export const confidence = dmi.enum("confidence", ["high", "medium", "low"]);
export const lane = dmi.enum("lane", ["auto_confirm", "review", "weekly_batch", "more_research"]);
export const signalStatus = dmi.enum("signal_status", ["pending", "confirmed", "rejected", "needs_info", "parked", "shadow"]);
export const rejectReason = dmi.enum("reject_reason", ["wrong_person", "not_a_change", "duplicate", "out_of_date", "not_relevant"]);
export const spotCheckResult = dmi.enum("spot_check_result", ["correct", "incorrect"]);
export const actionType = dmi.enum("action_type", [
  "congratulate", "check_in", "introduction_request", "invite_interview", "invite_event", "share_content",
  "pause", "reengage", "custom",
]);
export const actionStatus = dmi.enum("action_status", [
  "open", "drafted", "awaiting_approval", "approved", "sent", "done", "dismissed", "expired",
]);
export const dismissReason = dmi.enum("dismiss_reason", ["not_relevant", "already_known", "wrong_timing", "off_limits"]);
export const actionOutcome = dmi.enum("action_outcome", ["none", "no_reply", "replied", "meeting", "mandate"]);
export const draftChannel = dmi.enum("draft_channel", ["email", "linkedin_message"]);
export const draftAuthor = dmi.enum("draft_author", ["ai", "user"]);
export const band = dmi.enum("band", ["strong", "warm", "cooling", "cold", "none"]);
export const offLimitsScope = dmi.enum("off_limits_scope", ["company", "function", "level_and_above"]);
export const offLimitsReason = dmi.enum("off_limits_reason", ["current_client", "recent_placement", "contractual"]);
export const consentChannel = dmi.enum("consent_channel", ["email", "newsletter", "linkedin", "phone"]);
export const consentPurpose = dmi.enum("consent_purpose", ["outreach", "newsletter"]);
export const consentStatus = dmi.enum("consent_status", ["opted_in", "opted_out", "legitimate_interest", "unknown"]);
export const suppressionKind = dmi.enum("suppression_kind", ["email", "linkedin"]);
export const suppressionReason = dmi.enum("suppression_reason", ["erasure", "opt_out", "do_not_contact"]);
export const actorKind = dmi.enum("actor_kind", ["user", "system", "platform_admin"]);
export const secretKind = dmi.enum("secret_kind", ["apollo_api_key", "hubspot_private_app_token", "newsletter_api_key"]);
export const queueItemKind = dmi.enum("queue_item_kind", ["data_conflict", "possible_duplicate"]);
export const queueItemStatus = dmi.enum("queue_item_status", ["pending", "resolved"]);
export const aiCallStatus = dmi.enum("ai_call_status", ["ok", "error"]);
export const interestSource = dmi.enum("interest_source", ["first_party", "manual", "ai", "apollo"]);

// ---------------------------------------------------------------------------------------------
// Shared column helpers
// ---------------------------------------------------------------------------------------------

const tz = { withTimezone: true } as const;
const id = () => uuid().primaryKey().defaultRandom();
const createdAt = () => timestamp(tz).notNull().defaultNow();
const updatedAt = () => timestamp(tz).notNull().defaultNow().$onUpdate(() => new Date());
const textArray = () => text().array().notNull().default(sql`'{}'::text[]`);
const workspaceRef = () => uuid().notNull().references((): AnyPgColumn => workspaces.id, { onDelete: "cascade" });

// ---------------------------------------------------------------------------------------------
// 6.1 Core records
// ---------------------------------------------------------------------------------------------

export const workspaces = dmi.table("workspaces", {
  id: id(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  timezone: text().notNull().default("America/New_York"),
  packs: jsonb().notNull().default({}),
  flags: jsonb().notNull().default({}),
  settings: jsonb().notNull().default({}),
  /** Email domains allowed to sign in (BRD 5.2). Invited addresses are workspace_members rows. */
  allowedEmailDomains: textArray(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = dmi.table("users", {
  id: id(),
  email: text().notNull().unique(),
  name: text().notNull(),
  isPlatformAdmin: boolean().notNull().default(false),
  lastSignInAt: timestamp(tz),
  /** Authentication methods reported by the identity provider (`amr` claim), BRD 5.2. */
  lastAmr: text().array(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaceMembers = dmi.table(
  "workspace_members",
  {
    id: id(),
    workspaceId: workspaceRef(),
    userId: uuid().notNull().references(() => users.id, { onDelete: "cascade" }),
    role: memberRole().notNull(),
    invitedBy: uuid().references(() => users.id),
    status: memberStatus().notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.workspaceId, t.userId), index().on(t.userId), index().on(t.invitedBy)],
);

export const persons = dmi.table(
  "persons",
  {
    id: id(),
    workspaceId: workspaceRef(),
    fullName: text().notNull(),
    preferredName: text(),
    nameNormalised: text().notNull(),
    linkedinUrl: text(),
    city: text(),
    region: text(),
    country: text(),
    contactTypes: textArray(),
    relationshipOwnerId: uuid().references(() => users.id),
    status: personStatus().notNull().default("active"),
    isTracked: boolean().notNull().default(true),
    isOffList: boolean().notNull().default(false),
    isPriority: boolean().notNull().default(false),
    mergedIntoId: uuid().references((): AnyPgColumn => persons.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.workspaceId, t.nameNormalised),
    index().on(t.workspaceId, t.linkedinUrl),
    uniqueIndex("persons_workspace_linkedin_unique").on(t.workspaceId, t.linkedinUrl).where(sql`${t.linkedinUrl} is not null`),
    index().on(t.relationshipOwnerId),
    index().on(t.mergedIntoId),
    check("persons_country_iso2", sql`${t.country} is null or ${t.country} ~ '^[A-Z]{2}$'`),
  ],
);

export const companies = dmi.table(
  "companies",
  {
    id: id(),
    workspaceId: workspaceRef(),
    name: text().notNull(),
    nameNormalised: text().notNull(),
    aliases: textArray(),
    domain: text(),
    secCik: text(),
    ownership: ownershipType().notNull().default("unknown"),
    isSponsor: boolean().notNull().default(false),
    hqCountry: text(),
    hqRegion: text(),
    industry: text(),
    employeeCount: integer(),
    sizeBand: sizeBand().notNull().default("unknown"),
    targetTier: smallint(),
    clientStatus: clientStatus().notNull().default("none"),
    apolloOrgId: text(),
    intentTopics: jsonb(),
    leadershipPageUrls: textArray(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.workspaceId, t.domain),
    uniqueIndex("companies_workspace_domain_unique").on(t.workspaceId, t.domain).where(sql`${t.domain} is not null`),
    index().on(t.workspaceId, t.secCik),
    index().on(t.workspaceId, t.nameNormalised),
    check("companies_target_tier", sql`${t.targetTier} is null or ${t.targetTier} in (1, 2, 3)`),
    check("companies_sec_cik_format", sql`${t.secCik} is null or ${t.secCik} ~ '^[0-9]{10}$'`),
  ],
);

export const roles = dmi.table(
  "roles",
  {
    id: id(),
    workspaceId: workspaceRef(),
    personId: uuid().notNull().references(() => persons.id, { onDelete: "cascade" }),
    companyId: uuid().notNull().references(() => companies.id),
    seatType: seatType().notNull(),
    title: text().notNull(),
    titleNormalised: text(),
    function: text(),
    seniority: seniority().notNull().default("other"),
    businessEmail: text(),
    emailStatus: emailStatus().notNull().default("unknown"),
    announcedOn: date(),
    effectiveOn: date(),
    endedOn: date(),
    status: roleStatus().notNull(),
    isPrimary: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.personId, t.companyId, t.titleNormalised, t.effectiveOn).nullsNotDistinct(),
    uniqueIndex("roles_one_primary_per_person").on(t.personId).where(sql`${t.isPrimary}`),
    index().on(t.workspaceId, t.businessEmail),
    index().on(t.personId, t.status),
    index().on(t.companyId),
    check("roles_email_lowercase", sql`${t.businessEmail} is null or ${t.businessEmail} = lower(${t.businessEmail})`),
  ],
);

export const sponsorLinks = dmi.table(
  "sponsor_links",
  {
    id: id(),
    workspaceId: workspaceRef(),
    sponsorCompanyId: uuid().notNull().references(() => companies.id),
    portfolioCompanyId: uuid().notNull().references(() => companies.id),
    dealType: text(),
    acquiredOn: date(),
    exitedOn: date(),
    dealPartnerPersonId: uuid().references(() => persons.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.sponsorCompanyId), index().on(t.portfolioCompanyId), index().on(t.dealPartnerPersonId)],
);

export const connections = dmi.table(
  "connections",
  {
    id: id(),
    workspaceId: workspaceRef(),
    personAId: uuid().notNull().references(() => persons.id, { onDelete: "cascade" }),
    personBId: uuid().notNull().references(() => persons.id, { onDelete: "cascade" }),
    type: connectionType().notNull(),
    companyId: uuid().references(() => companies.id),
    periodStart: date(),
    periodEnd: date(),
    weight: numeric({ precision: 3, scale: 2 }).notNull(),
    derived: boolean().notNull(),
    note: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.personAId, t.personBId, t.type, t.companyId).nullsNotDistinct(),
    index().on(t.personBId),
    index().on(t.companyId),
    check("connections_ordered_pair", sql`${t.personAId} < ${t.personBId}`),
    check("connections_weight_range", sql`${t.weight} >= 0 and ${t.weight} <= 1`),
  ],
);

/** Person interests with their source (BRD 14 and 8.6). Not in BRD 6; see DECISIONS.md. */
export const personInterests = dmi.table(
  "person_interests",
  {
    id: id(),
    workspaceId: workspaceRef(),
    personId: uuid().notNull().references(() => persons.id, { onDelete: "cascade" }),
    topic: text().notNull(),
    source: interestSource().notNull(),
    sourceUrl: text(),
    capturedAt: timestamp(tz).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.personId, t.topic, t.source)],
);

// ---------------------------------------------------------------------------------------------
// 6.2 Activity
// ---------------------------------------------------------------------------------------------

export const interactions = dmi.table(
  "interactions",
  {
    id: id(),
    workspaceId: workspaceRef(),
    personId: uuid().notNull().references(() => persons.id, { onDelete: "cascade" }),
    roleId: uuid().references(() => roles.id, { onDelete: "set null" }),
    channel: channel().notNull(),
    direction: direction().notNull(),
    occurredAt: timestamp(tz).notNull(),
    ourUserId: uuid().references(() => users.id),
    subject: text(),
    summary: text(),
    threadKey: text(),
    provider: text().notNull(),
    externalId: text(),
    capturedBy: capturedBy().notNull(),
    isPrivate: boolean().notNull().default(false),
    contentTopic: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.workspaceId, t.personId, t.occurredAt.desc()),
    uniqueIndex().on(t.workspaceId, t.provider, t.externalId),
    index().on(t.roleId),
    index().on(t.ourUserId),
    index().on(t.workspaceId, t.threadKey),
  ],
);

/** Per-user addresses and domains that capture never records (BRD 11.3). See DECISIONS.md. */
export const captureExclusions = dmi.table(
  "capture_exclusions",
  {
    id: id(),
    workspaceId: workspaceRef(),
    userId: uuid().notNull().references(() => users.id, { onDelete: "cascade" }),
    pattern: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.workspaceId, t.userId, t.pattern)],
);

export const briefs = dmi.table(
  "briefs",
  {
    id: id(),
    workspaceId: workspaceRef(),
    personId: uuid().notNull().references(() => persons.id, { onDelete: "cascade" }),
    calendarEventId: uuid().references((): AnyPgColumn => calendarEvents.id, { onDelete: "set null" }),
    contentMarkdown: text().notNull(),
    model: text(),
    promptVersion: text(),
    generatedAt: timestamp(tz).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.personId), index().on(t.calendarEventId)],
);

export const calendarEvents = dmi.table(
  "calendar_events",
  {
    id: id(),
    workspaceId: workspaceRef(),
    userId: uuid().notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text().notNull(),
    externalId: text().notNull(),
    startsAt: timestamp(tz).notNull(),
    endsAt: timestamp(tz).notNull(),
    title: text(),
    attendeeEmails: textArray(),
    personIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    briefId: uuid().references((): AnyPgColumn => briefs.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex().on(t.workspaceId, t.provider, t.externalId),
    index().on(t.userId, t.startsAt),
    index().on(t.briefId),
  ],
);

export const oauthConnections = dmi.table(
  "oauth_connections",
  {
    id: id(),
    workspaceId: workspaceRef(),
    userId: uuid().notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text().notNull(),
    scopes: textArray(),
    tokenCiphertext: bytea(),
    tokenKeyId: text(),
    status: oauthStatus().notNull().default("active"),
    lastSyncAt: timestamp(tz),
    deltaCursor: text(),
    errorMessage: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.workspaceId, t.userId, t.provider)],
);

// ---------------------------------------------------------------------------------------------
// 6.3 Signals and provenance
// ---------------------------------------------------------------------------------------------

export const feeds = dmi.table(
  "feeds",
  {
    id: id(),
    workspaceId: workspaceRef(),
    sourceType: sourceType().notNull(),
    name: text().notNull(),
    config: jsonb().notNull().default({}),
    enabled: boolean().notNull().default(true),
    lastRunAt: timestamp(tz),
    lastError: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.workspaceId, t.sourceType)],
);

export const rawItems = dmi.table(
  "raw_items",
  {
    id: id(),
    workspaceId: workspaceRef(),
    sourceType: sourceType().notNull(),
    feedId: uuid().references(() => feeds.id, { onDelete: "set null" }),
    externalId: text().notNull(),
    url: text(),
    title: text(),
    bodyText: text(),
    publishedAt: timestamp(tz),
    payload: jsonb(),
    processedAt: timestamp(tz),
    outcome: rawItemOutcome(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex().on(t.workspaceId, t.sourceType, t.externalId),
    index().on(t.feedId),
    index().on(t.workspaceId, t.processedAt),
    check("raw_items_body_max", sql`${t.bodyText} is null or char_length(${t.bodyText}) <= 50000`),
  ],
);

export const signals = dmi.table(
  "signals",
  {
    id: id(),
    workspaceId: workspaceRef(),
    subjectType: subjectType().notNull(),
    personId: uuid().references(() => persons.id, { onDelete: "cascade" }),
    companyId: uuid().references(() => companies.id),
    roleId: uuid().references(() => roles.id, { onDelete: "set null" }),
    type: signalType().notNull(),
    headline: text().notNull(),
    evidence: text(),
    eventOn: date(),
    announcedOn: date(),
    effectiveOn: date(),
    foundAt: timestamp(tz).notNull().defaultNow(),
    foundBy: foundBy().notNull(),
    matchScore: numeric({ precision: 3, scale: 2 }),
    confidence: confidence().notNull(),
    priority: smallint().notNull(),
    lane: lane().notNull(),
    status: signalStatus().notNull(),
    researchCycles: smallint().notNull().default(0),
    dedupeKey: text().notNull(),
    mergedIntoId: uuid().references((): AnyPgColumn => signals.id),
    validatedBy: uuid().references(() => users.id),
    validatedAt: timestamp(tz),
    confirmedAt: timestamp(tz),
    rejectReason: rejectReason(),
    isSpotCheck: boolean().notNull().default(false),
    spotCheckResult: spotCheckResult(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.workspaceId, t.status, t.priority, t.foundAt),
    index().on(t.workspaceId, t.dedupeKey),
    index().on(t.personId),
    index().on(t.companyId),
    index().on(t.roleId),
    index().on(t.mergedIntoId),
    index().on(t.validatedBy),
    check("signals_subject_present", sql`${t.personId} is not null or ${t.companyId} is not null`),
    check("signals_priority_range", sql`${t.priority} in (1, 2, 3)`),
    check("signals_headline_max", sql`char_length(${t.headline}) <= 140`),
    check("signals_evidence_max", sql`${t.evidence} is null or char_length(${t.evidence}) <= 300`),
    check("signals_research_cycles_max", sql`${t.researchCycles} between 0 and 2`),
    check("signals_match_score_range", sql`${t.matchScore} is null or (${t.matchScore} >= 0 and ${t.matchScore} <= 1)`),
  ],
);

export const signalSources = dmi.table(
  "signal_sources",
  {
    id: id(),
    workspaceId: workspaceRef(),
    signalId: uuid().notNull().references(() => signals.id, { onDelete: "cascade" }),
    rawItemId: uuid().references(() => rawItems.id, { onDelete: "set null" }),
    sourceType: sourceType().notNull(),
    url: text(),
    title: text(),
    publishedAt: timestamp(tz),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.signalId), index().on(t.rawItemId)],
);

export const fieldSources = dmi.table(
  "field_sources",
  {
    id: id(),
    workspaceId: workspaceRef(),
    entityType: text().notNull(),
    entityId: uuid().notNull(),
    field: text().notNull(),
    value: text(),
    sourceType: sourceType().notNull(),
    sourceUrl: text(),
    capturedAt: timestamp(tz).notNull().defaultNow(),
    lastCheckedAt: timestamp(tz),
    confidence: confidence().notNull(),
    isCurrent: boolean().notNull().default(true),
    inConflict: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.workspaceId, t.entityType, t.entityId, t.field),
    check("field_sources_entity_type", sql`${t.entityType} in ('person', 'company', 'role')`),
  ],
);

// ---------------------------------------------------------------------------------------------
// 6.4 Actions and outputs
// ---------------------------------------------------------------------------------------------

export const contentItems = dmi.table(
  "content_items",
  {
    id: id(),
    workspaceId: workspaceRef(),
    title: text().notNull(),
    url: text(),
    description: text(),
    topics: textArray(),
    publishedOn: date(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.workspaceId, t.publishedOn)],
);

export const actions = dmi.table(
  "actions",
  {
    id: id(),
    workspaceId: workspaceRef(),
    signalId: uuid().references(() => signals.id, { onDelete: "set null" }),
    /** Null only for the "Find the right contact at <company>" case in BRD 12.1. */
    personId: uuid().references(() => persons.id, { onDelete: "cascade" }),
    companyId: uuid().references(() => companies.id),
    type: actionType().notNull(),
    status: actionStatus().notNull().default("open"),
    headline: text(),
    ownerUserId: uuid().notNull().references(() => users.id),
    dueAt: timestamp(tz).notNull(),
    bestPath: jsonb(),
    whyItMatters: text(),
    dismissReason: dismissReason(),
    blockedReason: text(),
    outcome: actionOutcome().notNull().default("none"),
    outcomeAt: timestamp(tz),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.workspaceId, t.ownerUserId, t.status, t.dueAt),
    index().on(t.signalId),
    index().on(t.personId),
    index().on(t.companyId),
    check("actions_subject_present", sql`${t.personId} is not null or ${t.companyId} is not null`),
  ],
);

export const drafts = dmi.table(
  "drafts",
  {
    id: id(),
    workspaceId: workspaceRef(),
    actionId: uuid().notNull().references(() => actions.id, { onDelete: "cascade" }),
    channel: draftChannel().notNull(),
    subject: text(),
    body: text().notNull(),
    version: integer().notNull().default(1),
    author: draftAuthor().notNull(),
    model: text(),
    promptVersion: text(),
    contentItemId: uuid().references(() => contentItems.id, { onDelete: "set null" }),
    approvedBy: uuid().references(() => users.id),
    approvedAt: timestamp(tz),
    sentAt: timestamp(tz),
    providerMessageId: text(),
    sendError: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex().on(t.actionId, t.version),
    index().on(t.contentItemId),
    index().on(t.approvedBy),
  ],
);

export const relationshipScores = dmi.table(
  "relationship_scores",
  {
    id: id(),
    workspaceId: workspaceRef(),
    personId: uuid().notNull().references(() => persons.id, { onDelete: "cascade" }),
    /** Null means the firm-level score. */
    userId: uuid().references(() => users.id, { onDelete: "cascade" }),
    score: smallint().notNull(),
    band: band().notNull(),
    factors: jsonb().notNull(),
    lastTwoWayAt: timestamp(tz),
    computedAt: timestamp(tz).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // BRD 6.4 keys this on (workspace_id, person_id, user_id) with user_id null for firm level;
    // a primary key cannot hold a null, so this is a unique constraint with NULLS NOT DISTINCT.
    unique("relationship_scores_key").on(t.workspaceId, t.personId, t.userId).nullsNotDistinct(),
    index().on(t.personId),
    index().on(t.userId),
    check("relationship_scores_range", sql`${t.score} between 0 and 100`),
  ],
);

// ---------------------------------------------------------------------------------------------
// 6.5 Executive search pack
// ---------------------------------------------------------------------------------------------

export const offLimits = dmi.table(
  "off_limits",
  {
    id: id(),
    workspaceId: workspaceRef(),
    companyId: uuid().notNull().references(() => companies.id, { onDelete: "cascade" }),
    scope: offLimitsScope().notNull(),
    function: text(),
    minSeniority: seniority(),
    reason: offLimitsReason().notNull(),
    startsOn: date().notNull(),
    endsOn: date(),
    setBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.companyId), index().on(t.setBy)],
);

export const placements = dmi.table(
  "placements",
  {
    id: id(),
    workspaceId: workspaceRef(),
    personId: uuid().notNull().references(() => persons.id, { onDelete: "cascade" }),
    companyId: uuid().notNull().references(() => companies.id),
    roleTitle: text().notNull(),
    placedOn: date().notNull(),
    searchReference: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.personId), index().on(t.companyId)],
);

export const mandateNotes = dmi.table(
  "mandate_notes",
  {
    id: id(),
    workspaceId: workspaceRef(),
    personId: uuid().references(() => persons.id, { onDelete: "cascade" }),
    companyId: uuid().references(() => companies.id, { onDelete: "cascade" }),
    body: text().notNull(),
    createdBy: uuid().notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.personId),
    index().on(t.companyId),
    index().on(t.createdBy),
    check("mandate_notes_subject", sql`${t.personId} is not null or ${t.companyId} is not null`),
  ],
);

// ---------------------------------------------------------------------------------------------
// 6.6 Compliance and operations
// ---------------------------------------------------------------------------------------------

export const consents = dmi.table(
  "consents",
  {
    id: id(),
    workspaceId: workspaceRef(),
    personId: uuid().notNull().references(() => persons.id, { onDelete: "cascade" }),
    channel: consentChannel().notNull(),
    purpose: consentPurpose().notNull(),
    status: consentStatus().notNull(),
    jurisdiction: text(),
    capturedVia: text(),
    proof: text(),
    recordedAt: timestamp(tz).notNull().defaultNow(),
    recordedBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.personId, t.channel, t.purpose), index().on(t.recordedBy)],
);

export const suppressions = dmi.table(
  "suppressions",
  {
    id: id(),
    workspaceId: workspaceRef(),
    hash: text().notNull(),
    kind: suppressionKind().notNull(),
    reason: suppressionReason().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.workspaceId, t.kind, t.hash)],
);

export const sourceStatsWeekly = dmi.table(
  "source_stats_weekly",
  {
    id: id(),
    workspaceId: workspaceRef(),
    feedId: uuid().notNull().references(() => feeds.id, { onDelete: "cascade" }),
    weekStart: date().notNull(),
    rawItems: integer().notNull().default(0),
    signalsCreated: integer().notNull().default(0),
    confirmed: integer().notNull().default(0),
    rejected: integer().notNull().default(0),
    autoConfirmed: integer().notNull().default(0),
    spotCheckErrors: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.feedId, t.weekStart)],
);

/** Append-only. The application roles hold no UPDATE or DELETE grant on this table. */
export const auditLog = dmi.table(
  "audit_log",
  {
    id: id(),
    /** Null only for platform-level entries that belong to no workspace. */
    workspaceId: uuid().references(() => workspaces.id, { onDelete: "cascade" }),
    actorUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    actorKind: actorKind().notNull(),
    action: text().notNull(),
    entityType: text(),
    entityId: uuid(),
    before: jsonb(),
    after: jsonb(),
    ip: text(),
    userAgent: text(),
    at: timestamp(tz).notNull().defaultNow(),
  },
  (t) => [index().on(t.workspaceId, t.at), index().on(t.workspaceId, t.entityType, t.entityId), index().on(t.actorUserId)],
);

export const aiCalls = dmi.table(
  "ai_calls",
  {
    id: id(),
    workspaceId: workspaceRef(),
    purpose: text().notNull(),
    model: text().notNull(),
    promptVersion: text().notNull(),
    inputTokens: integer(),
    outputTokens: integer(),
    costUsd: numeric({ precision: 10, scale: 4 }),
    latencyMs: integer(),
    status: aiCallStatus().notNull(),
    error: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.workspaceId, t.createdAt)],
);

/** Write-only from the interface; never returned by any API (BRD 6.6). */
export const workspaceSecrets = dmi.table(
  "workspace_secrets",
  {
    id: id(),
    workspaceId: workspaceRef(),
    kind: secretKind().notNull(),
    ciphertext: bytea().notNull(),
    keyId: text().notNull(),
    updatedBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.workspaceId, t.kind)],
);

export const queueItems = dmi.table(
  "queue_items",
  {
    id: id(),
    workspaceId: workspaceRef(),
    kind: queueItemKind().notNull(),
    payload: jsonb().notNull(),
    status: queueItemStatus().notNull().default("pending"),
    resolvedBy: uuid().references(() => users.id),
    resolvedAt: timestamp(tz),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.workspaceId, t.status, t.createdAt), index().on(t.resolvedBy)],
);
