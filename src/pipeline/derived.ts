/**
 * Signals raised by rules rather than extraction (BRD 9.3): first-party content engagement, from
 * the interests the newsletter adapter records (BRD 8.6), and CEO tenure past the threshold. Both
 * are priority 3 and go to the weekly batch. Idempotent: each fires once per subject.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { companies, personInterests, persons, roles, signals, workspaces } from "@/db/schema";

export async function raiseDerivedSignals(tx: Tx, workspaceId: string, now = new Date()): Promise<number> {
  const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  const settings = (ws!.settings ?? {}) as { ceo_tenure_years?: number };
  const flags = ws!.flags as Record<string, boolean>;
  const lane = flags["validation.batch_p3"] === false ? "review" : "weekly_batch";
  const status = flags["pipeline.shadow"] ? "shadow" : "pending";
  const today = now.toISOString().slice(0, 10);
  let raised = 0;

  // First-party interest: one signal per person and topic.
  const interests = await tx
    .select({ personId: personInterests.personId, topic: personInterests.topic, name: persons.fullName })
    .from(personInterests)
    .innerJoin(persons, eq(persons.id, personInterests.personId))
    // Newly captured only: the newsletter job records a first-party interest when the third click lands.
    .where(and(eq(personInterests.source, "first_party"), sql`${persons.mergedIntoId} is null`, sql`${personInterests.capturedAt} >= ${now}::timestamptz - interval '7 days'`));
  for (const i of interests) {
    const key = `${i.personId}:person_content_engagement:${i.topic.toLowerCase()}`;
    const [exists] = await tx.select({ id: signals.id }).from(signals).where(eq(signals.dedupeKey, key)).limit(1);
    if (exists) continue;
    await tx.insert(signals).values({
      workspaceId, subjectType: "person", personId: i.personId, type: "person_content_engagement",
      headline: `${i.name} is reading about ${i.topic.toLowerCase()}`.slice(0, 140), foundAt: now, foundBy: "feed_rule",
      confidence: "medium", priority: 3, lane, status, dedupeKey: key, eventOn: today,
      explanation: { rule: "Three or more newsletter clicks on one topic within 30 days (BRD 8.6)" },
    });
    raised++;
  }

  // CEO tenure: once per CEO role when it passes the threshold (default 7 years).
  const years = settings.ceo_tenure_years ?? 7;
  const ceos = await tx
    .select({ roleId: roles.id, companyId: roles.companyId, personId: roles.personId, since: roles.effectiveOn, company: companies.name, name: persons.fullName })
    .from(roles)
    .innerJoin(companies, eq(companies.id, roles.companyId))
    .innerJoin(persons, eq(persons.id, roles.personId))
    .where(and(eq(roles.titleNormalised, "CEO"), eq(roles.status, "current"), sql`${roles.effectiveOn} <= ${today}::date - make_interval(years => ${years})`));
  for (const c of ceos) {
    const key = `${c.roleId}:company_ceo_tenure_threshold`;
    const [exists] = await tx.select({ id: signals.id }).from(signals).where(eq(signals.dedupeKey, key)).limit(1);
    if (exists) continue;
    await tx.insert(signals).values({
      workspaceId, subjectType: "company", companyId: c.companyId, personId: c.personId, roleId: c.roleId, type: "company_ceo_tenure_threshold",
      headline: `${c.name} has led ${c.company} for more than ${years} years`.slice(0, 140), foundAt: now, foundBy: "feed_rule",
      confidence: "high", priority: 3, lane, status, dedupeKey: key, eventOn: today,
      explanation: { rule: `Current CEO tenure past ${years} years (BRD 9.3)` },
    });
    raised++;
  }
  return raised;
}
