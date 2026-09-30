/**
 * Field-level provenance (BRD 6.3). Every change to a key field is recorded with its source.
 * Two sources that disagree are both kept: the field shows the higher-confidence value, both rows
 * are flagged in_conflict, and a data_conflict queue item is raised for a validator.
 */
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { fieldSources, queueItems } from "@/db/schema";

export type EntityType = "person" | "company" | "role";
export type Confidence = "high" | "medium" | "low";
export type SourceType = (typeof fieldSources.$inferInsert)["sourceType"];

const RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

export interface FieldObservation {
  workspaceId: string;
  entityType: EntityType;
  entityId: string;
  field: string;
  value: string | null;
  sourceType: SourceType;
  sourceUrl?: string | null;
  confidence: Confidence;
}

export type ObservationResult =
  /** The value to show on the record, and whether it differs from what was shown before. */
  | { outcome: "unchanged" | "set" | "replaced"; current: string | null }
  | { outcome: "conflict"; current: string | null; queueItemId: string };

/** Records one observation of a field value and returns the value the record should show. */
export async function observeField(tx: Tx, o: FieldObservation): Promise<ObservationResult> {
  const existing = await tx
    .select()
    .from(fieldSources)
    .where(and(eq(fieldSources.entityType, o.entityType), eq(fieldSources.entityId, o.entityId), eq(fieldSources.field, o.field)));
  const now = new Date();
  const current = existing.find((r) => r.isCurrent);

  const row = {
    workspaceId: o.workspaceId,
    entityType: o.entityType,
    entityId: o.entityId,
    field: o.field,
    value: o.value,
    sourceType: o.sourceType,
    sourceUrl: o.sourceUrl ?? null,
    confidence: o.confidence,
    capturedAt: now,
    lastCheckedAt: now,
  };

  if (!current) {
    await tx.insert(fieldSources).values({ ...row, isCurrent: true });
    return { outcome: "set", current: o.value };
  }

  if (current.value === o.value) {
    // The shown value is confirmed: refresh the same source's row, or keep another source's
    // agreement as corroboration.
    const sameSource = existing.find((r) => r.value === o.value && r.sourceType === o.sourceType);
    if (sameSource) await tx.update(fieldSources).set({ lastCheckedAt: now }).where(eq(fieldSources.id, sameSource.id));
    else await tx.insert(fieldSources).values({ ...row, isCurrent: false });
    return { outcome: "unchanged", current: current.value };
  }

  if (current.sourceType === o.sourceType) {
    // The same source now says something else: the newer observation replaces the older one.
    await tx.update(fieldSources).set({ isCurrent: false, inConflict: false }).where(eq(fieldSources.id, current.id));
    await tx.insert(fieldSources).values({ ...row, isCurrent: true });
    return { outcome: "replaced", current: o.value };
  }

  // Different sources disagree. Show the higher-confidence value; on a tie, keep what is shown.
  const incomingWins = RANK[o.confidence] > RANK[current.confidence as Confidence];
  if (incomingWins) await tx.update(fieldSources).set({ isCurrent: false, inConflict: true }).where(eq(fieldSources.id, current.id));
  else await tx.update(fieldSources).set({ inConflict: true }).where(eq(fieldSources.id, current.id));
  const [inserted] = await tx.insert(fieldSources).values({ ...row, isCurrent: incomingWins, inConflict: true }).returning({ id: fieldSources.id });
  const [item] = await tx
    .insert(queueItems)
    .values({
      workspaceId: o.workspaceId,
      kind: "data_conflict",
      payload: {
        entity_type: o.entityType,
        entity_id: o.entityId,
        field: o.field,
        field_source_ids: [current.id, inserted!.id],
        values: [current.value, o.value],
      },
    })
    .returning({ id: queueItems.id });
  return { outcome: "conflict", current: incomingWins ? o.value : current.value, queueItemId: item!.id };
}
