/**
 * Runs the relationship jobs once for the demo (BRD 21: connections "derived by the nightly job
 * from the seeded roles"): connections, scores, then going-quiet alerts with their drafts.
 */
import { deriveConnections } from "@/domain/connections";
import { draftForAction } from "@/domain/actions";
import { raiseGoingQuiet } from "@/domain/quiet";
import { recomputeScores } from "@/domain/relationships";

export async function stageDemoRelationships(workspaceId: string, now = new Date()) {
  const connections = await deriveConnections(workspaceId, now.toISOString().slice(0, 10));
  const scores = await recomputeScores(workspaceId, now);
  const quiet = await raiseGoingQuiet(workspaceId, now);
  for (const id of quiet.toDraft) await draftForAction(workspaceId, id, { now: () => now }).catch(() => undefined);
  return { connections: connections.derived, bands: scores.firm, quiet: quiet.raised };
}
