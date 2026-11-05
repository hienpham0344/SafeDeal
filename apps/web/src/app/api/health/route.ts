import { NextResponse } from "next/server";

/** Liveness probe for the web app itself (separate from the backend /api/v1/health). */
export function GET() {
  return NextResponse.json({ status: "UP", service: "safedeal-web" });
}
