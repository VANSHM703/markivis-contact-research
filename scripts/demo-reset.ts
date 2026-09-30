/**
 * npm run demo:reset: drops the schema, migrates from scratch, loads the seed workspaces, then in
 * mock mode runs every source once (leadership pages twice, to produce their diffs) and the
 * pipeline, so the demo opens with a populated queue, then stages actions in each state (BRD 21).
 */
import { getDataMode } from "@/config/env";
import { closeDatabase } from "@/db/client";
import { loadSeed } from "@/db/seed";
import { stageDemoActions, stageDemoBriefs } from "@/db/seed/demo-actions";
import { stageDemoCapture } from "@/db/seed/demo-capture";
import { stageDemoRelationships } from "@/db/seed/demo-relationships";
import { runSource } from "@/ingest/run";
import { runPipeline } from "@/jobs/handlers";
import { resetDatabase } from "./migrate";

async function main() {
  await resetDatabase();
  const bundle = await loadSeed();
  for (const w of bundle.workspaces) {
    console.log(`${w.workspace.name}: ${w.companies.length} companies, ${w.persons.length} people, ${w.roles.length} roles, ${w.interactions.length} interactions`);
  }
  if (getDataMode() === "mock" && !process.argv.includes("--seed-only")) {
    const demo = bundle.workspaces[0]!.workspace.id;
    for (const source of ["sec_8k", "press_wire", "google_alert", "leadership_page", "leadership_page", "apollo", "newsletter"] as const) await runSource(demo, source, { mode: "mock" });
    const { processed, derived } = await runPipeline(demo);
    console.log(`Demo Search Partners: ${processed} items through the pipeline, ${derived} rule-based signals.`);
    const captured = await stageDemoCapture(demo);
    console.log(`Mailbox capture: ${captured.mail} emails and ${captured.meetings} meetings with tracked people logged for Jordan Ellis.`);
    const rel = await stageDemoRelationships(demo);
    console.log(`Relationships: ${rel.connections} connections derived; bands ${JSON.stringify(rel.bands)}; ${rel.quiet} going-quiet alerts.`);
    const staged = await stageDemoActions(demo);
    const briefsMade = await stageDemoBriefs(demo);
    console.log(`Briefs: ${briefsMade} written for meetings in the next two days.`);
    console.log(`Actions staged: ${Object.values(staged).filter(Boolean).length} (awaiting approval, sent, escalated, lawful basis needed).`);
  }
  console.log("Sign in at /intelligence/sign-in as any of:");
  for (const u of bundle.users) console.log(`  ${u.name} <${u.email}>`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
