import { and, eq } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { companies, persons, users, workspaceMembers, workspaces } from "@/db/schema";

export interface WorkspaceFixture {
  id: string;
  slug: string;
  personIds: string[];
  companyIds: string[];
  partnerUserId: string;
}

/** Reads both seeded workspaces, as the system role, for use in assertions. */
export async function loadFixtures(): Promise<{ demo: WorkspaceFixture; harbor: WorkspaceFixture }> {
  return withSystem("test", async (tx) => {
    const read = async (slug: string): Promise<WorkspaceFixture> => {
      const [ws] = await tx.select().from(workspaces).where(eq(workspaces.slug, slug));
      if (!ws) throw new Error(`Seed workspace ${slug} missing.`);
      const ps = await tx.select({ id: persons.id }).from(persons).where(eq(persons.workspaceId, ws.id));
      const cs = await tx.select({ id: companies.id }).from(companies).where(eq(companies.workspaceId, ws.id));
      const [partner] = await tx
        .select({ id: users.id })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.role, "partner")));
      return { id: ws.id, slug, personIds: ps.map((p) => p.id), companyIds: cs.map((c) => c.id), partnerUserId: partner!.id };
    };
    return { demo: await read("demo-search-partners"), harbor: await read("harbor-search-group") };
  });
}

/** Drizzle wraps driver errors; the PostgreSQL message is on the cause. */
export async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    return cause?.message ?? (error as Error).message;
  }
  return "no error";
}

class Rollback extends Error {}

/**
 * Runs fn in a workspace-scoped transaction and rolls it back afterwards, so tests that change
 * records never disturb the seed that other tests count.
 */
export async function inRolledBackWorkspace<T>(workspaceId: string, fn: (tx: import("@/db/client").Tx) => Promise<T>): Promise<T> {
  const { withWorkspace } = await import("@/db/client");
  let result: T | undefined;
  try {
    await withWorkspace(workspaceId, async (tx) => {
      result = await fn(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  return result as T;
}
