import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api/respond";

export const GET = apiRoute("records.view", async (ctx) =>
  NextResponse.json({
    user: { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email },
    workspace: { id: ctx.workspace.id, name: ctx.workspace.name, slug: ctx.workspace.slug },
    role: ctx.role,
    workspaces: ctx.memberships.map((m) => ({ id: m.workspaceId, name: m.workspaceName, role: m.role })),
  }),
);
