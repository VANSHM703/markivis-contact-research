import { ExportError, personExport } from "@/domain/exports";
import { apiRoute, jsonError } from "@/lib/api/respond";
import { zip, zipResponse } from "@/lib/export/zip";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Everything held about one person, as JSON and CSV in a ZIP (BRD 18.2 access). Audited. */
export const GET = apiRoute<{ id: string }>("compliance.manage", async (ctx, _request, { id }) => {
  if (!UUID_RE.test(id)) return jsonError(404, "Person not found.");
  try {
    const { filename, entries } = await personExport({ workspaceId: ctx.workspace.id, userId: ctx.user.id }, id);
    return zipResponse(zip(entries), filename);
  } catch (error) {
    if (error instanceof ExportError) return jsonError(404, "Person not found.");
    throw error;
  }
});
