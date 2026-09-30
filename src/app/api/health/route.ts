import { NextResponse } from "next/server";

/** Liveness check for the proxy and container host. Touches no database. */
export function GET() {
  return NextResponse.json({ status: "ok" });
}
