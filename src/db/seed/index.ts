/** Loads the seed bundle into an empty database (BRD 21). Runs as dmi_system. */
import type { PgTable } from "drizzle-orm/pg-core";
import { withSystem, type Tx } from "../client";
import * as s from "../schema";
import { audit } from "@/lib/audit";
import { generateSeed, type SeedBundle } from "./generate";

async function insertChunked(tx: Tx, table: PgTable, rows: object[], size = 250): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await tx.insert(table).values(rows.slice(i, i + size) as never);
  }
}

export async function loadSeed(now: Date = new Date()): Promise<SeedBundle> {
  const bundle = generateSeed(now);
  await withSystem("seed", async (tx) => {
    await insertChunked(tx, s.users, bundle.users);
    for (const w of bundle.workspaces) {
      await tx.insert(s.workspaces).values(w.workspace);
      await insertChunked(tx, s.workspaceMembers, w.members);
      await insertChunked(tx, s.companies, w.companies);
      await insertChunked(tx, s.persons, w.persons);
      await insertChunked(tx, s.roles, w.roles);
      await insertChunked(tx, s.sponsorLinks, w.sponsorLinks);
      await insertChunked(tx, s.placements, w.placements);
      await insertChunked(tx, s.offLimits, w.offLimits);
      await insertChunked(tx, s.contentItems, w.contentItems);
      await insertChunked(tx, s.feeds, w.feeds);
      await insertChunked(tx, s.interactions, w.interactions);
      await insertChunked(tx, s.calendarEvents, w.calendarEvents);
      await insertChunked(tx, s.consents, w.consents);
      await insertChunked(tx, s.fieldSources, w.fieldSources);
      await insertChunked(tx, s.personInterests, w.personInterests);
      await audit(tx, {
        workspaceId: w.workspace.id,
        actorUserId: null,
        actorKind: "system",
        action: "seed.loaded",
        entityType: "workspace",
        entityId: w.workspace.id,
        after: { people: w.persons.length, companies: w.companies.length, roles: w.roles.length, interactions: w.interactions.length },
      });
    }
  });
  return bundle;
}
