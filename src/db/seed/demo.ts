/**
 * Stages the demo workspace after the seed loads (BRD 21: every screen populated): every mock
 * source (leadership pages twice, for their diffs) and the pipeline, Jordan's demo mailbox, the
 * relationship jobs, actions in each state, briefs, and people for the retention review. Used by
 * demo:reset, docker compose (setup) and the end-to-end setup, so all three open the same demo.
 * Mock mode only.
 */
import { runSource } from "@/ingest/run";
import { runPipeline } from "@/jobs/handlers";
import { stageDemoActions, stageDemoBriefs } from "./demo-actions";
import { stageDemoCapture } from "./demo-capture";
import { stageDemoCompliance } from "./demo-compliance";
import { stageDemoRelationships } from "./demo-relationships";

export async function stageDemo(workspaceId: string, log: (line: string) => void = () => undefined): Promise<void> {
  for (const source of ["sec_8k", "press_wire", "google_alert", "leadership_page", "leadership_page", "apollo", "newsletter"] as const) await runSource(workspaceId, source, { mode: "mock" });
  const { processed, derived } = await runPipeline(workspaceId);
  log(`Pipeline: ${processed} items, ${derived} rule-based signals.`);
  const captured = await stageDemoCapture(workspaceId);
  log(`Mailbox capture: ${captured.mail} emails and ${captured.meetings} meetings with tracked people logged for Jordan Ellis.`);
  const rel = await stageDemoRelationships(workspaceId);
  log(`Relationships: ${rel.connections} connections derived; bands ${JSON.stringify(rel.bands)}; ${rel.quiet} going-quiet alerts.`);
  const staged = await stageDemoActions(workspaceId);
  log(`Actions staged: ${Object.values(staged).filter(Boolean).length} (awaiting approval, sent, escalated, lawful basis needed).`);
  log(`Briefs: ${await stageDemoBriefs(workspaceId)} written for meetings in the next two days.`);
  const compliance = await stageDemoCompliance(workspaceId);
  log(`Compliance: ${compliance.former} former executives for the retention review; ${compliance.suppressed} unsubscribed addresses suppressed.`);
}
