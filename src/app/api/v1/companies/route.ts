import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api/respond";
import { pageParam } from "@/lib/format/labels";
import { listCompanies, PAGE_SIZE } from "@/server/records";

export const GET = apiRoute("records.view", async (ctx, request) => {
  const page = pageParam(new URL(request.url).searchParams.get("page") ?? undefined);
  const { rows, total } = await listCompanies(ctx.workspace.id, page);
  return NextResponse.json({ data: rows, page, pageSize: PAGE_SIZE, total });
});
