/**
 * The signal pipeline (BRD 9.1): raw item, then pre-filter, extract (AI), resolve, propose record
 * changes, dedupe, confidence, priority, lane and status; on confirmation, apply the changes and
 * create the action. Each raw item is processed in its own transactions, with the AI call outside
 * them. An item that fails twice is marked error and shown in data health.
 */
import { and, asc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { AiOutputError, getAi, type AiAdapter } from "@/ai/adapter";
import { recordAiCall } from "@/ai/budget";
import type { ExtractOutput, SignalType } from "@/ai/contracts";
import { SIGNAL_TYPES } from "@/ai/contracts";
import { withWorkspace, type Tx } from "@/db/client";
import { companies, placements, rawItems, roles, signals, signalSources, workspaces } from "@/db/schema";
import { resolveCompany } from "@/domain/matching";
import { normaliseTitle } from "@/domain/titles";
import { draftForAction } from "@/domain/actions";
import { log } from "@/lib/log";
import { buildIndex, prefilter, type PrefilterResult, type WorkspaceIndex } from "./prefilter";
import { combineConfidence, dedupeKey, eventDateOf, laneOf, priorityOf, SIGNAL_RULES, withinDays, type SourceFacts } from "./rules";
import { confirmSignal } from "./validation";

export const BATCH_SIZE = 25;
export const MAX_ATTEMPTS = 2;

export type ProposedChange =
  | { kind: "end_role"; role_id: string; person_id: string; company_id: string; title: string; ended_on: string }
  | { kind: "add_role"; person_id: string; company_id: string; title: string; status: "announced" | "current"; effective_on: string | null; announced_on: string | null }
  | { kind: "set_off_list"; person_id: string };

type RawItem = typeof rawItems.$inferSelect;
type Ws = { flags: Record<string, boolean>; settings: Record<string, unknown>; timezone: string };

export interface ProcessResult {
  rawItemId: string;
  outcome: "irrelevant" | "signal_created" | "signal_merged" | "error" | "skipped";
  signalId?: string;
  lane?: string;
  status?: string;
  reason?: string;
  /** An action created by auto-confirmation, drafted after the transaction commits. */
  actionId?: string;
}

// ---------------------------------------------------------------------------------------------
// Extraction without AI: Apollo job changes are already structured
// ---------------------------------------------------------------------------------------------

function apolloExtraction(item: RawItem): ExtractOutput | null {
  const p = item.payload as { kind?: string; person_id?: string; current?: { organizationName: string; title: string }; previous?: { title: string } } | null;
  if (!p?.person_id || !p.current) return null;
  const date = (item.publishedAt ?? item.createdAt).toISOString().slice(0, 10);
  return {
    is_relevant: true,
    signal_type: p.kind === "job_change_title" ? "person_promotion" : "person_joined",
    subject_kind: "person",
    person_candidate_id: p.person_id,
    company_candidate_id: null,
    match_confidence: 0.85,
    new_title: p.current.title,
    previous_title: p.previous?.title ?? null,
    event_date: date,
    announced_date: null,
    effective_date: null,
    headline: (item.title ?? "").replace(/^Apollo: /, "").slice(0, 140),
    evidence_quote: (item.bodyText ?? "").slice(0, 300),
  };
}

// ---------------------------------------------------------------------------------------------
// Resolve and propose (BRD 7.2, 7.3, 9.1 stages 3 and 4)
// ---------------------------------------------------------------------------------------------

interface Resolved {
  type: SignalType;
  subjectType: "person" | "company";
  personId: string | null;
  companyId: string | null;
  roleId: string | null;
  strongMatch: boolean;
  offList: boolean;
  proposed: ProposedChange[];
  companyDomain: string | null;
}

async function resolve(tx: Tx, item: RawItem, x: ExtractOutput, pre: PrefilterResult): Promise<Resolved | null> {
  if (!x.signal_type || !(SIGNAL_TYPES as readonly string[]).includes(x.signal_type)) return null;
  const allowed = new Set(pre.candidates.map((c) => c.id));
  // The model may only choose supplied candidates; anything else is discarded (BRD 17.2).
  const personId = x.person_candidate_id && allowed.has(x.person_candidate_id) ? x.person_candidate_id : null;
  let companyId = x.company_candidate_id && allowed.has(x.company_candidate_id) ? x.company_candidate_id : null;
  let type = x.signal_type as SignalType;

  if (SIGNAL_RULES[type].subject === "person" && !personId) {
    // A person-level change about someone who is not tracked is a company-level leadership change.
    if (!companyId || !["person_joined", "person_left", "person_move_announced", "person_promotion"].includes(type)) return null;
    type = "company_cxo_change";
  }
  if (SIGNAL_RULES[type].subject === "company" && !companyId) {
    if (!personId) return null;
    const [primary] = await tx.select({ companyId: roles.companyId }).from(roles).where(and(eq(roles.personId, personId), eq(roles.isPrimary, true))).limit(1);
    companyId = primary?.companyId ?? null;
    if (!companyId) return null;
  }

  const personRoles = personId ? await tx.select().from(roles).where(eq(roles.personId, personId)) : [];
  let apolloOffList = false;
  if (item.sourceType === "apollo" && personId) {
    // Apollo names the employer: resolve it by domain, then name. An unknown employer is off the list.
    const current = (item.payload as { current?: { organizationName: string; organizationDomain: string | null } } | null)?.current;
    companyId = current ? await resolveCompany(tx, { name: current.organizationName, domain: current.organizationDomain }) : null;
    if (!companyId && type === "person_joined") apolloOffList = true;
    if (!companyId && type === "person_promotion") companyId = personRoles.find((r) => r.isPrimary)?.companyId ?? null;
  }
  if (personId && !companyId && !apolloOffList) {
    // Default to the company the text is about, else the person's primary employer.
    companyId = pre.companyIds.find((c) => personRoles.some((r) => r.companyId === c)) ?? personRoles.find((r) => r.isPrimary)?.companyId ?? pre.companyIds[0] ?? null;
  }
  const [company] = companyId ? await tx.select().from(companies).where(eq(companies.id, companyId)).limit(1) : [];

  const atCompany = personRoles.filter((r) => r.companyId === companyId && r.status !== "ended");
  const prevNorm = x.previous_title ? normaliseTitle(x.previous_title).titleNormalised : null;
  const role = atCompany.find((r) => prevNorm && r.titleNormalised === prevNorm) ?? atCompany.find((r) => r.isPrimary) ?? atCompany[0] ?? null;

  // Step 3 of BRD 7.2 (name and a matching role), a known person ID from Apollo, or a company by domain or CIK.
  const namedCompanies = new Set([...pre.companyIds, ...(companyId ? [companyId] : [])]);
  const strongMatch = personId
    ? (pre.namedPersonIds.includes(personId) && personRoles.some((r) => namedCompanies.has(r.companyId))) || item.sourceType === "apollo"
    : !!companyId && pre.strongCompanyIds.includes(companyId);

  const effective = x.effective_date;
  const eventOn = x.event_date ?? x.announced_date ?? (item.publishedAt ?? item.createdAt).toISOString().slice(0, 10);
  const proposed: ProposedChange[] = [];
  let offList = false;
  const newTitle = x.new_title?.trim() || null;

  if (personId && companyId) {
    if (type === "person_left" && role) {
      proposed.push({ kind: "end_role", role_id: role.id, person_id: personId, company_id: companyId, title: role.title, ended_on: effective ?? eventOn });
    } else if (type === "person_board_change") {
      const boardRole = atCompany.find((r) => r.seatType === "board");
      if (newTitle && !boardRole) proposed.push({ kind: "add_role", person_id: personId, company_id: companyId, title: newTitle, status: effective && effective > eventOn ? "announced" : "current", effective_on: effective ?? eventOn, announced_on: x.announced_date ?? eventOn });
      else if (boardRole && (!newTitle || /director|board/i.test(x.previous_title ?? "") || /step|retire|leave|resign/i.test(x.headline))) {
        proposed.push({ kind: "end_role", role_id: boardRole.id, person_id: personId, company_id: companyId, title: boardRole.title, ended_on: effective ?? eventOn });
      }
    } else if ((type === "person_joined" || type === "person_move_announced") && newTitle) {
      const status = type === "person_move_announced" || (effective && effective > eventOn) ? "announced" : "current";
      proposed.push({ kind: "add_role", person_id: personId, company_id: companyId, title: newTitle, status, effective_on: effective ?? eventOn, announced_on: x.announced_date ?? eventOn });
      if (status === "current") {
        // The old executive role ends when the new one starts (BRD 7.3 "Joins a new organisation").
        for (const old of personRoles.filter((r) => r.status === "current" && r.seatType !== "board" && r.companyId !== companyId)) {
          proposed.push({ kind: "end_role", role_id: old.id, person_id: personId, company_id: old.companyId, title: old.title, ended_on: effective ?? eventOn });
        }
      }
    } else if (type === "person_promotion" && newTitle && role) {
      proposed.push({ kind: "end_role", role_id: role.id, person_id: personId, company_id: companyId, title: role.title, ended_on: effective ?? eventOn });
      proposed.push({ kind: "add_role", person_id: personId, company_id: companyId, title: newTitle, status: "current", effective_on: effective ?? eventOn, announced_on: null });
    }
  } else if (personId && apolloOffList) {
    // Apollo reports an employer we do not track: the person moves off the target list (BRD 7.3).
    offList = true;
    proposed.push({ kind: "set_off_list", person_id: personId });
  }

  return { type, subjectType: SIGNAL_RULES[type].subject === "company" || !personId ? "company" : "person", personId, companyId, roleId: role?.id ?? null, strongMatch, offList, proposed, companyDomain: company?.domain ?? null };
}

// ---------------------------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------------------------

function suspendedSources(settings: Record<string, unknown>): Record<string, unknown> {
  return ((settings.validation as { suspended_sources?: Record<string, unknown> } | undefined)?.suspended_sources ?? {}) as Record<string, unknown>;
}

const verbatim = (quote: string, text: string) => {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  return quote.trim().length > 0 && norm(text).includes(norm(quote));
};

async function mark(workspaceId: string, itemId: string, outcome: "irrelevant" | "signal_created" | "signal_merged" | "error", now: Date, error?: string) {
  await withWorkspace(workspaceId, (tx) => tx.update(rawItems).set({ processedAt: now, outcome, lastError: error ?? null }).where(eq(rawItems.id, itemId)));
}

export async function processRawItem(workspaceId: string, itemId: string, ai: AiAdapter, index: WorkspaceIndex, now: Date): Promise<ProcessResult> {
  // Stage 1: pre-filter.
  const prep = await withWorkspace(workspaceId, async (tx) => {
    const [item] = await tx.select().from(rawItems).where(eq(rawItems.id, itemId)).limit(1);
    if (!item || item.processedAt) return null;
    const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    const pre = prefilter({ sourceType: item.sourceType, title: item.title, bodyText: item.bodyText, url: item.url, payload: item.payload as Record<string, unknown> | null }, index);
    return { item, pre, ws: { flags: ws!.flags as Record<string, boolean>, settings: ws!.settings as Record<string, unknown>, timezone: ws!.timezone } as Ws };
  });
  if (!prep) return { rawItemId: itemId, outcome: "skipped" };
  const { item, pre, ws } = prep;
  if (!pre.pass) {
    await mark(workspaceId, itemId, "irrelevant", now);
    return { rawItemId: itemId, outcome: "irrelevant", reason: pre.reason };
  }

  // Stage 2: extract. Structured sources skip the model.
  let extraction: ExtractOutput | null = item.sourceType === "apollo" ? apolloExtraction(item) : null;
  let aiNote: string | null = null;
  if (!extraction) {
    try {
      const result = await ai.extractSignal({
        rawItemExternalId: item.externalId,
        title: item.title ?? "",
        bodyText: item.bodyText ?? "",
        sourceType: item.sourceType,
        publishedAt: item.publishedAt?.toISOString() ?? null,
        candidates: pre.candidates,
      });
      extraction = result.output;
      await withWorkspace(workspaceId, (tx) => recordAiCall(tx, workspaceId, result.call, ws.settings, now));
    } catch (error) {
      if (!(error instanceof AiOutputError)) throw error;
      await withWorkspace(workspaceId, (tx) => recordAiCall(tx, workspaceId, error.call, ws.settings, now));
      aiNote = "AI could not read this item";
    }
  }
  if (!aiNote && (!extraction || !extraction.is_relevant)) {
    await mark(workspaceId, itemId, "irrelevant", now);
    return { rawItemId: itemId, outcome: "irrelevant", reason: "The model found no change about a candidate" };
  }

  // Stages 3 to 9, in one transaction.
  const result = await withWorkspace(workspaceId, async (tx): Promise<ProcessResult> => {
    let resolved: Resolved | null = null;
    if (extraction && !aiNote) resolved = await resolve(tx, item, extraction, pre);
    if (!resolved && aiNote) {
      // The AI failed twice: a person reads the item (BRD 17.1), filed against the first candidate.
      const companyId = pre.companyIds[0] ?? null;
      const personId = pre.namedPersonIds[0] ?? null;
      if (!companyId && !personId) {
        await tx.update(rawItems).set({ processedAt: now, outcome: "error", lastError: aiNote }).where(eq(rawItems.id, itemId));
        return { rawItemId: itemId, outcome: "error", reason: aiNote };
      }
      resolved = { type: "other", subjectType: personId ? "person" : "company", personId, companyId, roleId: null, strongMatch: false, offList: false, proposed: [], companyDomain: null };
    }
    if (!resolved) {
      await tx.update(rawItems).set({ processedAt: now, outcome: "irrelevant" }).where(eq(rawItems.id, itemId));
      return { rawItemId: itemId, outcome: "irrelevant", reason: "The extraction did not resolve to a tracked person or company" };
    }

    const quoted = !!extraction && !aiNote && verbatim(extraction.evidence_quote, `${item.title ?? ""}\n${item.bodyText ?? ""}`);
    const evidence = quoted ? extraction!.evidence_quote.slice(0, 300) : null;
    const source: SourceFacts = { rawItemId: item.id, sourceType: item.sourceType, url: item.url, linkHost: (item.payload as { link_host?: string } | null)?.link_host ?? null, quoted: quoted || item.sourceType === "apollo" };
    const eventOn = extraction && !aiNote ? (extraction.event_date ?? extraction.announced_date ?? null) : null;
    const foundAt = now;
    const subjectId = (resolved.subjectType === "person" ? resolved.personId : resolved.companyId)!;
    const eventDate = eventDateOf({ eventOn, announcedOn: extraction?.announced_date ?? null, foundAt });
    const key = dedupeKey(subjectId, resolved.type, eventDate);
    const reputableOutlets = (ws.settings.reputable_outlets as string[] | undefined) ?? [];

    // Stage 5: dedupe. Same key, or same subject and type within 3 days of the event.
    const sameSubject = resolved.subjectType === "person" ? eq(signals.personId, subjectId) : and(eq(signals.companyId, subjectId), eq(signals.subjectType, "company"));
    const existing = (
      await tx.select().from(signals).where(and(isNull(signals.mergedIntoId), ne(signals.status, "rejected"), eq(signals.type, resolved.type), or(eq(signals.dedupeKey, key), sameSubject)))
    ).find((s) => s.dedupeKey === key || withinDays(eventDateOf({ eventOn: s.eventOn, announcedOn: s.announcedOn, foundAt: s.foundAt }), eventDate, 3));

    if (existing) {
      await tx.insert(signalSources).values({ workspaceId, signalId: existing.id, rawItemId: item.id, sourceType: item.sourceType, url: item.url, title: item.title, publishedAt: item.publishedAt });
      const all = await tx.select().from(signalSources).where(eq(signalSources.signalId, existing.id));
      const [company] = existing.companyId ? await tx.select({ domain: companies.domain }).from(companies).where(eq(companies.id, existing.companyId)).limit(1) : [];
      // One query at a time: a transaction's connection runs statements in sequence.
      const facts: SourceFacts[] = [];
      for (const s of all) {
        const [r] = s.rawItemId ? await tx.select({ payload: rawItems.payload }).from(rawItems).where(eq(rawItems.id, s.rawItemId)).limit(1) : [];
        facts.push({ rawItemId: s.rawItemId, sourceType: s.sourceType, url: s.url, linkHost: (r?.payload as { link_host?: string } | null)?.link_host ?? null, quoted: s.rawItemId === item.id ? source.quoted : true });
      }
      const confidence = combineConfidence(facts, { companyDomain: company?.domain ?? null, reputableOutlets });
      await tx
        .update(signals)
        .set({ confidence: confidence.confidence, evidence: existing.evidence ?? evidence, explanation: { ...(existing.explanation as object), confidence: confidence.reason, sources: all.length } })
        .where(eq(signals.id, existing.id));
      await tx.update(rawItems).set({ processedAt: now, outcome: "signal_merged" }).where(eq(rawItems.id, itemId));
      return { rawItemId: itemId, outcome: "signal_merged", signalId: existing.id };
    }

    // Stages 6 to 8.
    const confidence = combineConfidence([source], { companyDomain: resolved.companyDomain, reputableOutlets });
    const [placed] = resolved.personId ? await tx.select({ id: placements.id }).from(placements).where(eq(placements.personId, resolved.personId)).limit(1) : [];
    const priority = priorityOf({ type: resolved.type, personIsPlaced: !!placed, offList: resolved.offList });
    const suspended = Object.keys(suspendedSources(ws.settings)).includes(item.sourceType);
    const matchScore = extraction && !aiNote ? extraction.match_confidence : 0;
    const lane = laneOf({ type: resolved.type, priority: priority.priority, confidence, matchScore, strongMatch: resolved.strongMatch, sourceSuspended: suspended, batchP3: ws.flags["validation.batch_p3"] !== false });
    const shadow = ws.flags["pipeline.shadow"] === true;
    const headline = (aiNote ? `Needs reading: ${item.title ?? "untitled item"}` : extraction!.headline).slice(0, 140);

    const [signal] = await tx
      .insert(signals)
      .values({
        workspaceId,
        subjectType: resolved.subjectType,
        personId: resolved.personId,
        companyId: resolved.companyId,
        roleId: resolved.roleId,
        type: resolved.type,
        headline,
        evidence,
        eventOn,
        announcedOn: extraction && !aiNote ? extraction.announced_date : null,
        effectiveOn: extraction && !aiNote ? extraction.effective_date : null,
        foundAt,
        foundBy: item.sourceType === "apollo" ? "apollo" : "ai_scan",
        matchScore: String(matchScore.toFixed(2)),
        confidence: confidence.confidence,
        priority: priority.priority,
        lane: lane.lane,
        status: shadow ? "shadow" : "pending",
        dedupeKey: key,
        proposedChanges: resolved.proposed,
        explanation: { prefilter: pre.reason, confidence: confidence.reason, priority: priority.reason, lane: lane.reason, ...(aiNote ? { note: aiNote } : {}) },
      })
      .returning();
    await tx.insert(signalSources).values({ workspaceId, signalId: signal!.id, rawItemId: item.id, sourceType: item.sourceType, url: item.url, title: item.title, publishedAt: item.publishedAt });
    await tx.update(rawItems).set({ processedAt: now, outcome: "signal_created" }).where(eq(rawItems.id, itemId));

    // Stage 9: the auto-confirm lane confirms now, unless the workspace is in its shadow run.
    let actionId: string | undefined;
    if (lane.lane === "auto_confirm" && !shadow) {
      const { action } = await confirmSignal(tx, { workspaceId, userId: null, kind: "system" }, signal!.id, { auto: true, now });
      if (action?.needsDraft) actionId = action.actionId;
    }
    return { rawItemId: itemId, outcome: "signal_created", signalId: signal!.id, lane: lane.lane, status: lane.lane === "auto_confirm" && !shadow ? "confirmed" : shadow ? "shadow" : "pending", actionId };
  });
  return result;
}

export interface BatchResult {
  processed: ProcessResult[];
  remaining: number;
}

/** Processes up to BATCH_SIZE unprocessed raw items, oldest first (BRD 8.9 pipeline.process). */
export async function processPending(workspaceId: string, options: { ai?: AiAdapter; now?: () => Date; limit?: number } = {}): Promise<BatchResult> {
  const now = options.now ?? (() => new Date());
  const ai = options.ai ?? (await getAi(undefined, now));
  const { items, index } = await withWorkspace(workspaceId, async (tx) => ({
    items: await tx.select({ id: rawItems.id, attempts: rawItems.attempts }).from(rawItems).where(isNull(rawItems.processedAt)).orderBy(asc(rawItems.createdAt)).limit(options.limit ?? BATCH_SIZE),
    index: await buildIndex(tx),
  }));
  const processed: ProcessResult[] = [];
  for (const { id, attempts } of items) {
    try {
      const result = await processRawItem(workspaceId, id, ai, index, now());
      processed.push(result);
      if (result.actionId) {
        // Drafting is separate from the signal: a failed draft leaves the action to be redrafted.
        await draftForAction(workspaceId, result.actionId, { ai, now }).catch((error: unknown) =>
          log.error("pipeline.draft_failed", { workspaceId, actionId: result.actionId, error: (error as Error).message }),
        );
      }
    } catch (error) {
      const message = (error as Error).message.slice(0, 2000);
      const failed = attempts + 1 >= MAX_ATTEMPTS;
      await withWorkspace(workspaceId, (tx) =>
        tx.update(rawItems).set({ attempts: attempts + 1, lastError: message, ...(failed ? { processedAt: now(), outcome: "error" as const } : {}) }).where(eq(rawItems.id, id)),
      );
      log.error("pipeline.item_failed", { workspaceId, rawItemId: id, attempts: attempts + 1, error: message });
      processed.push({ rawItemId: id, outcome: failed ? "error" : "skipped", reason: message });
    }
  }
  const [{ n } = { n: 0 }] = await withWorkspace(workspaceId, (tx) => tx.select({ n: sql<number>`count(*)::int` }).from(rawItems).where(isNull(rawItems.processedAt)));
  return { processed, remaining: n };
}

