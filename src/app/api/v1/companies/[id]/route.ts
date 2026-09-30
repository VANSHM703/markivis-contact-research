import { NextResponse } from "next/server";
import { apiRoute, jsonError } from "@/lib/api/respond";
import { getCompany } from "@/server/records";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = apiRoute<{ id: string }>("records.view", async (ctx, _request, { id }) => {
  if (!UUID_RE.test(id)) return jsonError(404, "Company not found.");
  const record = await getCompany(ctx.workspace.id, id);
  return record ? NextResponse.json({ data: record }) : jsonError(404, "Company not found.");
});
