/**
 * Placements (BRD 13, 6.5): executives the firm has placed. A placed executive is a People filter,
 * every movement signal about them is priority 1 (BRD 7.3), and their leaving also creates a
 * backfill check-in (actions.ts). Entered by hand here, or imported (imports/pack.ts).
 */
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { companies, persons, placements } from "@/db/schema";
import { audit } from "@/lib/audit";
import { assertCan } from "@/lib/permissions";
import type { WorkspaceRole } from "@/config/navigation";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date format YYYY-MM-DD.").refine((v) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, "This is not a real date.");

export const placementSchema = z.object({
  personId: z.string().uuid(),
  companyId: z.string().uuid("Choose the company they were placed at."),
  roleTitle: z.string().trim().min(2, "Enter the role they were placed in.").max(200),
  placedOn: isoDate,
  searchReference: z.string().trim().max(80).optional().transform((v) => v || null),
});
export type PlacementInput = z.infer<typeof placementSchema>;

export class DuplicatePlacementError extends Error {
  constructor() {
    super("That placement is already recorded.");
  }
}

export async function addPlacement(tx: Tx, actor: { workspaceId: string; userId: string; role: WorkspaceRole }, input: PlacementInput, source: "manual" | "import" = "manual"): Promise<string> {
  assertCan(actor.role, "records.edit");
  const [person] = await tx.select({ id: persons.id }).from(persons).where(eq(persons.id, input.personId)).limit(1);
  const [company] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, input.companyId)).limit(1);
  if (!person || !company) throw new Error("That person or company is not in this workspace.");
  const [dupe] = await tx.select({ id: placements.id }).from(placements).where(and(eq(placements.personId, input.personId), eq(placements.companyId, input.companyId), eq(placements.placedOn, input.placedOn))).limit(1);
  if (dupe) throw new DuplicatePlacementError();
  const [row] = await tx.insert(placements).values({ workspaceId: actor.workspaceId, ...input }).returning({ id: placements.id });
  await audit(tx, { workspaceId: actor.workspaceId, actorUserId: actor.userId, actorKind: "user", action: "placement.added", entityType: "person", entityId: input.personId, after: { placement_id: row!.id, ...input, via: source } });
  return row!.id;
}

export async function placementsFor(tx: Tx, where: { personId?: string; companyId?: string }) {
  return tx
    .select({ id: placements.id, personId: placements.personId, personName: persons.fullName, companyId: placements.companyId, companyName: companies.name, roleTitle: placements.roleTitle, placedOn: placements.placedOn, searchReference: placements.searchReference })
    .from(placements)
    .innerJoin(persons, eq(persons.id, placements.personId))
    .innerJoin(companies, eq(companies.id, placements.companyId))
    .where(where.personId ? eq(placements.personId, where.personId) : eq(placements.companyId, where.companyId!))
    .orderBy(desc(placements.placedOn));
}
