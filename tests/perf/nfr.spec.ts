/**
 * BRD 19 speed and BRD 18.4 export, measured against a production build with 50,000 people:
 *   - person and company pages: server response under 500 ms at p95;
 *   - search: under 300 ms at p95;
 *   - the full workspace export: under 30 minutes.
 * Each page is requested 60 times after a warm-up, as a signed-in user, and the full response is
 * timed. Results are printed and written to tests/perf/results.json.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { Pool } from "pg";
import { PERF_ENV } from "./perf.config";

const SAMPLES = 60;
const results: Record<string, { p50: number; p95: number; max: number; n: number }> = {};

const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(p * values.length) - 1)]!;

async function timed(request: APIRequestContext, url: string): Promise<number> {
  const started = performance.now();
  const response = await request.get(url);
  await response.body();
  const ms = performance.now() - started;
  expect(response.status(), url).toBe(200);
  // A signed-out request would be redirected to the sign-in page, which also answers 200.
  expect(response.url(), url).not.toContain("/sign-in");
  return ms;
}

async function measure(request: APIRequestContext, name: string, urls: string[]): Promise<number> {
  for (const url of urls.slice(0, 5)) await timed(request, url);
  const times: number[] = [];
  for (const url of urls) times.push(await timed(request, url));
  results[name] = { p50: Math.round(percentile(times, 0.5)), p95: Math.round(percentile(times, 0.95)), max: Math.round(Math.max(...times)), n: times.length };
  console.log(`${name.padEnd(28)} p50 ${String(results[name].p50).padStart(5)} ms   p95 ${String(results[name].p95).padStart(5)} ms   max ${String(results[name].max).padStart(5)} ms`);
  return results[name].p95;
}

interface Sample {
  workspaceId: string;
  people: string[];
  companies: string[];
  terms: string[];
}

/** Random people, companies and search terms from the demo workspace, read as the system role. */
async function sample(): Promise<Sample> {
  const pool = new Pool({ connectionString: PERF_ENV.DATABASE_URL, max: 1 });
  try {
    const client = await pool.connect();
    try {
      await client.query("set role dmi_system");
      const [ws] = (await client.query("select id from dmi.workspaces where slug = 'demo-search-partners'")).rows as { id: string }[];
      const scoped = `workspace_id = '${ws!.id}'`;
      const people = (await client.query(`select id from dmi.persons where ${scoped} order by md5(id::text) limit ${SAMPLES}`)).rows.map((r) => r.id as string);
      const companies = (await client.query(`select id from dmi.companies where ${scoped} order by md5(id::text) limit ${SAMPLES}`)).rows.map((r) => r.id as string);
      // Whole names, family names and the first letters of one, as people type them.
      const names = (await client.query(`select full_name from dmi.persons where ${scoped} order by md5(full_name) limit ${SAMPLES}`)).rows.map((r) => r.full_name as string);
      const terms = names.map((n, i) => (i % 3 === 0 ? n : i % 3 === 1 ? n.split(" ")[1]! : n.split(" ")[1]!.slice(0, 5)));
      return { workspaceId: ws!.id, people, companies, terms };
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

test.afterAll(() => {
  const scale = JSON.parse(readFileSync("tests/perf/.auth/scale.json", "utf8")) as { people: number; companies: number };
  writeFileSync("tests/perf/results.json", `${JSON.stringify({ measured_at: new Date().toISOString(), scale, results }, null, 2)}\n`);
});

test.describe("with 50,000 people", () => {
  let s: Sample;
  test.beforeAll(async () => {
    s = await sample();
    const scale = JSON.parse(readFileSync("tests/perf/.auth/scale.json", "utf8")) as { people: number; companies: number };
    expect(scale.people).toBeGreaterThanOrEqual(50_000);
    expect(scale.companies).toBeGreaterThanOrEqual(2_000);
  });

  test.describe("as the partner", () => {
    test.use({ storageState: "tests/perf/.auth/partner.json" });

    test("person pages respond in under 500 ms at p95", async ({ request }) => {
      expect(await measure(request, "person page", s.people.map((id) => `people/${id}`))).toBeLessThan(500);
      expect(await measure(request, "person page, record tab", s.people.map((id) => `people/${id}?tab=record`))).toBeLessThan(500);
      expect(await measure(request, "person page, interactions", s.people.map((id) => `people/${id}?tab=interactions`))).toBeLessThan(500);
    });

    test("company pages respond in under 500 ms at p95", async ({ request }) => {
      expect(await measure(request, "company page", s.companies.map((id) => `companies/${id}`))).toBeLessThan(500);
    });

    test("search responds in under 300 ms at p95", async ({ request }) => {
      expect(await measure(request, "people search (API)", s.terms.map((q) => `api/v1/people/search?q=${encodeURIComponent(q)}`))).toBeLessThan(300);
      expect(await measure(request, "company search (API)", s.terms.map((_, i) => `api/v1/companies/search?q=${encodeURIComponent(`perfco ${i * 31}`)}`))).toBeLessThan(300);
      expect(await measure(request, "search page", s.terms.map((q) => `search?q=${encodeURIComponent(q)}`))).toBeLessThan(300);
    });

    test("the people list pages respond in under 500 ms at p95", async ({ request }) => {
      expect(await measure(request, "people list", Array.from({ length: SAMPLES }, (_, i) => `people?page=${1 + ((i * 37) % 900)}`))).toBeLessThan(500);
    });
  });

  test.describe("as the data steward", () => {
    test.use({ storageState: "tests/perf/.auth/steward.json" });

    test("the full workspace export completes in under 30 minutes", async ({ request }) => {
      const started = performance.now();
      const response = await request.get("api/v1/exports/workspace", { timeout: 30 * 60_000 });
      const body = await response.body();
      const ms = performance.now() - started;
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toBe("application/zip");
      results["workspace export"] = { p50: Math.round(ms), p95: Math.round(ms), max: Math.round(ms), n: 1 };
      console.log(`workspace export             ${Math.round(ms / 1000)} s, ${Math.round(body.length / 1_048_576)} MB`);
      expect(ms).toBeLessThan(30 * 60_000);
    });

    test("a person's access export responds in under 2 s", async ({ request }) => {
      expect(await measure(request, "person access export", s.people.slice(0, 20).map((id) => `api/v1/people/${id}/export`))).toBeLessThan(2_000);
    });
  });
});
