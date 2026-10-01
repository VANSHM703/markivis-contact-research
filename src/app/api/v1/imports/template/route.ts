import { contentTemplate } from "@/domain/content";
import { packTemplate } from "@/domain/imports/pack";
import { targetListTemplate } from "@/domain/imports/target-list";
import { jsonError, apiRoute } from "@/lib/api/respond";
import { execSearchOn } from "@/lib/packs";

const FILES = { target_list: "target-list-template.csv", placements: "placements-template.csv", off_limits: "off-limits-template.csv", content_library: "content-library-template.csv" } as const;

/** CSV templates: every column, with one fictional example row. `?kind=` picks the import. */
export const GET = apiRoute("records.view", async (ctx, request) => {
  const kind = (new URL(request.url).searchParams.get("kind") ?? "target_list") as keyof typeof FILES;
  if (!(kind in FILES)) return jsonError(404, "No template of that kind.");
  if ((kind === "placements" || kind === "off_limits") && !execSearchOn(ctx.workspace)) return jsonError(404, "No template of that kind.");
  const body = kind === "target_list" ? targetListTemplate() : kind === "content_library" ? contentTemplate() : packTemplate(kind);
  return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${FILES[kind]}"` } });
});
