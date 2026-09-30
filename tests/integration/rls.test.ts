/**
 * Tenancy isolation at the database layer (BRD 5.1). Proves row-level security is on for every
 * workspace table and that a scoped transaction cannot see or write another workspace's rows.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, MissingWorkspaceScopeError, withSystem, withWorkspace } from "@/db/client";
import { auditLog, persons } from "@/db/schema";
import { dbError, loadFixtures, type WorkspaceFixture } from "./helpers";

let demo: WorkspaceFixture;
let harbor: WorkspaceFixture;
let workspaceTables: string[];

beforeAll(async () => {
  ({ demo, harbor } = await loadFixtures());
  workspaceTables = await withSystem("test", async (tx) => {
    const result = await tx.execute<{ table_name: string }>(sql`
      select c.table_name from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'dmi' and c.column_name = 'workspace_id' and t.table_type = 'BASE TABLE'
      order by c.table_name`);
    return result.rows.map((r) => r.table_name);
  });
});

afterAll(() => closeDatabase());

describe("row-level security", () => {
  it("is enabled and forced, with a policy, on every table in the dmi schema", async () => {
    const rows = await withSystem("test", async (tx) => {
      const result = await tx.execute<{ relname: string; enabled: boolean; forced: boolean; policies: number }>(sql`
        select c.relname, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
          (select count(*)::int from pg_policies p where p.schemaname = 'dmi' and p.tablename = c.relname) as policies
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'dmi' and c.relkind = 'r'`);
      return result.rows;
    });
    expect(rows.length).toBeGreaterThanOrEqual(33);
    const unprotected = rows.filter((r) => !r.enabled || !r.forced || r.policies < 1).map((r) => r.relname);
    expect(unprotected).toEqual([]);
  });

  it("shows a workspace none of another workspace's rows, in any table", async () => {
    expect(workspaceTables.length).toBeGreaterThanOrEqual(31);
    for (const [viewer, other] of [[demo, harbor], [harbor, demo]] as const) {
      const leaks = await withWorkspace(viewer.id, async (tx) => {
        const found: string[] = [];
        for (const table of workspaceTables) {
          const result = await tx.execute<{ n: number }>(
            sql`select count(*)::int as n from ${sql.identifier("dmi")}.${sql.identifier(table)} where workspace_id = ${other.id}`,
          );
          if ((result.rows[0]?.n ?? 0) > 0) found.push(table);
        }
        const ws = await tx.execute<{ n: number }>(sql`select count(*)::int as n from dmi.workspaces where id = ${other.id}`);
        if ((ws.rows[0]?.n ?? 0) > 0) found.push("workspaces");
        return found;
      });
      expect(leaks, `${viewer.slug} can see rows of ${other.slug}`).toEqual([]);
    }
  });

  it("still shows a workspace its own rows", async () => {
    const count = await withWorkspace(demo.id, async (tx) => (await tx.select({ n: sql<number>`count(*)::int` }).from(persons))[0]?.n);
    expect(count).toBe(150);
  });

  it("rejects a write carrying another workspace's ID", async () => {
    const message = await dbError(
      withWorkspace(demo.id, (tx) =>
        tx.insert(persons).values({ workspaceId: harbor.id, fullName: "Cross Tenant", nameNormalised: "cross tenant" }),
      ),
    );
    expect(message).toMatch(/row-level security/);
  });

  it("returns nothing when no workspace is set", async () => {
    // Simulates a query that bypassed withWorkspace(): the setting is empty, so no row matches.
    const count = await withSystem("test", async (tx) => {
      await tx.execute(sql`set local role dmi_app`);
      return (await tx.select({ n: sql<number>`count(*)::int` }).from(persons))[0]?.n;
    });
    expect(count).toBe(0);
  });

  it("refuses to open a scoped transaction without a valid workspace ID", async () => {
    await expect(withWorkspace("", async () => 1)).rejects.toBeInstanceOf(MissingWorkspaceScopeError);
    await expect(withWorkspace("not-a-uuid", async () => 1)).rejects.toBeInstanceOf(MissingWorkspaceScopeError);
  });

  it("keeps the audit log append-only", async () => {
    expect(await dbError(withWorkspace(demo.id, (tx) => tx.update(auditLog).set({ action: "tampered" })))).toMatch(/permission denied/);
    expect(await dbError(withWorkspace(demo.id, (tx) => tx.delete(auditLog)))).toMatch(/permission denied/);
    expect(await dbError(withSystem("test", (tx) => tx.delete(auditLog)))).toMatch(/permission denied/);
  });
});
