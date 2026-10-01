/**
 * Generated tenancy test (BRD 22.1 and acceptance scenario 23). Finds every API route under
 * src/app/api/v1, calls each exported handler as a user of workspace A with route parameters
 * pointing at workspace B's records, and fails if any response carries a workspace B identifier.
 *
 * A new route with a dynamic segment must add its parameter to PARAM_SOURCES, or this test fails.
 */
import { globSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDatabase } from "@/db/client";
import { unzip } from "../helpers/unzip";
import { loadFixtures, type WorkspaceFixture } from "./helpers";

const contextState = vi.hoisted(() => ({ userId: null as string | null, workspaceId: null as string | null }));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: { GET: vi.fn(), POST: vi.fn() },
  isMockSignInEnabled: () => true,
}));

vi.mock("@/lib/context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/context")>();
  return {
    ...actual,
    getRequestContext: async () =>
      contextState.userId ? actual.buildContext(contextState.userId, contextState.workspaceId) : null,
  };
});

const API_ROOT = path.resolve("src/app/api/v1");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

interface RouteCase {
  file: string;
  urlPath: string;
  params: string[];
  resource: string | null;
}

function discoverRoutes(): RouteCase[] {
  return globSync("**/route.ts", { cwd: API_ROOT }).map((file) => {
    const segments = path.dirname(file).split(path.sep).filter((s) => s !== ".");
    const params = segments.filter((s) => /^\[.+\]$/.test(s)).map((s) => s.slice(1, -1));
    const firstParam = segments.findIndex((s) => /^\[.+\]$/.test(s));
    return { file, urlPath: `/api/v1/${segments.join("/")}`, params, resource: firstParam > 0 ? segments[firstParam - 1]! : null };
  });
}

/** Which of the other workspace's records to aim each dynamic segment at. */
/** The response as text; a ZIP export is unpacked, so a leak inside it is still found. */
async function readBody(response: Response): Promise<string> {
  if (response.headers.get("content-type") !== "application/zip") return response.text();
  return [...unzip(Buffer.from(await response.arrayBuffer())).values()].map((b) => b.toString("utf8")).join("\n");
}

const PARAM_SOURCES: Record<string, (w: WorkspaceFixture) => string[]> = {
  "people:id": (w) => w.personIds.slice(0, 5),
  "companies:id": (w) => w.companyIds.slice(0, 5),
};

let demo: WorkspaceFixture;
let harbor: WorkspaceFixture;
const routes = discoverRoutes();

beforeAll(async () => {
  ({ demo, harbor } = await loadFixtures());
});
afterAll(() => closeDatabase());

describe("API tenancy isolation", () => {
  it("discovers the API routes", () => {
    expect(routes.length).toBeGreaterThanOrEqual(5);
  });

  for (const route of routes) {
    it(`${route.urlPath} never returns another workspace's rows`, async () => {
      const mod = (await import(path.join(API_ROOT, route.file))) as Record<string, unknown>;
      const handlers = METHODS.filter((m) => typeof mod[m] === "function");
      expect(handlers.length, `${route.urlPath} exports no handler`).toBeGreaterThan(0);

      for (const [viewer, other] of [[demo, harbor], [harbor, demo]] as const) {
        const forbidden = [other.id, ...other.personIds, ...other.companyIds];
        const paramSets: Record<string, string>[] = [{}];
        for (const param of route.params) {
          const source = PARAM_SOURCES[`${route.resource}:${param}`];
          expect(source, `add "${route.resource}:${param}" to PARAM_SOURCES`).toBeDefined();
          const values = source!(other);
          paramSets.splice(0, paramSets.length, ...paramSets.flatMap((set) => values.map((v) => ({ ...set, [param]: v }))));
        }

        // As the partner, and as the data steward, who alone can reach the export routes.
        for (const userId of [viewer.partnerUserId, viewer.stewardUserId].filter((u): u is string => !!u)) {
          contextState.userId = userId;
          contextState.workspaceId = viewer.id;
          for (const method of handlers) {
            for (const params of paramSets) {
              const handler = mod[method] as (req: Request, seg: { params: Promise<Record<string, string>> }) => Promise<Response>;
              const request = new Request(`http://localhost/intelligence${route.urlPath}`, { method });
              const response = await handler(request, { params: Promise.resolve(params) });
              const body = await readBody(response);
              if (route.params.length > 0) expect([403, 404], `${method} ${route.urlPath} ${JSON.stringify(params)}`).toContain(response.status);
              const leaked = forbidden.filter((id) => body.includes(id));
              expect(leaked, `${method} ${route.urlPath} as ${viewer.slug}`).toEqual([]);
            }
          }
        }
      }
    });

    it(`${route.urlPath} requires sign-in`, async () => {
      const mod = (await import(path.join(API_ROOT, route.file))) as Record<string, unknown>;
      contextState.userId = null;
      for (const method of METHODS.filter((m) => typeof mod[m] === "function")) {
        const handler = mod[method] as (req: Request, seg: { params: Promise<Record<string, string>> }) => Promise<Response>;
        const response = await handler(new Request(`http://localhost/intelligence${route.urlPath}`, { method }), { params: Promise.resolve({ id: demo.personIds[0]! }) });
        expect(response.status).toBe(401);
      }
    });
  }

  it("returns a workspace its own records", async () => {
    const mod = (await import(path.join(API_ROOT, "people/[id]/route.ts"))) as { GET: (r: Request, s: { params: Promise<{ id: string }> }) => Promise<Response> };
    contextState.userId = demo.partnerUserId;
    contextState.workspaceId = demo.id;
    const response = await mod.GET(new Request("http://localhost/intelligence/api/v1/people/x"), { params: Promise.resolve({ id: demo.personIds[0]! }) });
    expect(response.status).toBe(200);
  });
});
