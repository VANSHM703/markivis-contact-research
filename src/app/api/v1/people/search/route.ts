import { NextResponse } from "next/server";
import { withWorkspace } from "@/db/client";
import { searchPeople } from "@/domain/matching";
import { apiRoute } from "@/lib/api/respond";

export const GET = apiRoute("records.view", async (ctx, request) => {
  const q = new URL(request.url).searchParams.get("q")?.slice(0, 100) ?? "";
  const data = q.trim() ? await withWorkspace(ctx.workspace.id, (tx) => searchPeople(tx, q)) : [];
  return NextResponse.json({ data });
});
