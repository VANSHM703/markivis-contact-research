import { workspaceExport } from "@/domain/exports";
import { apiRoute } from "@/lib/api/respond";
import { zip, zipResponse } from "@/lib/export/zip";

/** The whole workspace: every table as CSV and JSON, and a schema description (BRD 18.4). Audited. */
export const GET = apiRoute("data.export_all", async (ctx) => {
  const { filename, entries } = await workspaceExport({ workspaceId: ctx.workspace.id, userId: ctx.user.id });
  return zipResponse(zip(entries), filename);
});
