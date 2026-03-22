import { NextResponse } from "next/server";
import { isBlocked } from "../../../../lib/ofac";

// GET /api/ofac/check?address=r...
// Public endpoint — no admin auth needed, just returns blocked status.
export function GET(request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");

  if (!address) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }

  const result = isBlocked(address, { action: "ONBOARDING_LOAD" });
  return NextResponse.json(result);
}
