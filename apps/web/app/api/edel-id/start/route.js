import { NextResponse } from "next/server";
import { isBlocked } from "../../../../lib/ofac";

const EDEL_ID_BASE   = "https://verifier.edel-id.ch";
const CLAIMS_FULL    = ["$.age_over_18", "$.given_name", "$.family_name", "$.nationality"];
const CLAIMS_MINIMAL = ["$.age_over_18", "$.nationality"];

export async function POST(request) {
  const body   = await request.json().catch(() => ({}));
  const { flow, walletAddress } = body;

  // ── AML / OFAC screening ──────────────────────────────────────────────────
  if (walletAddress) {
    const screen = isBlocked(walletAddress, { action: "KYC_ATTEMPT" });
    if (screen.blocked) {
      return NextResponse.json(
        { error: "AML_BLOCKED", label: screen.label, source: screen.source },
        { status: 403 }
      );
    }
  }

  // ── Start Edel-ID session ─────────────────────────────────────────────────
  const claims = flow === "minimal" ? CLAIMS_MINIMAL : CLAIMS_FULL;

  const res = await fetch(`${EDEL_ID_BASE}/api/verification`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ verificationClaims: claims }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Failed to start verification" }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json(data);
}
