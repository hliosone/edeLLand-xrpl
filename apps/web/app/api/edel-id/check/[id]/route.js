const EDEL_ID_BASE   = "https://verifier.edel-id.ch";
const CLAIMS_FULL    = ["$.age_over_18", "$.given_name", "$.family_name", "$.nationality"];
const CLAIMS_MINIMAL = ["$.age_over_18", "$.nationality"];

export async function POST(request, { params }) {
  const { id } = await params;
  const body   = await request.json().catch(() => ({}));
  const claims = body.flow === "minimal" ? CLAIMS_MINIMAL : CLAIMS_FULL;

  const upstream = await fetch(`${EDEL_ID_BASE}/api/verification/${id}`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ verificationClaims: claims }),
  });

  if (!upstream.ok) {
    return new Response(JSON.stringify({ error: "Failed to connect SSE" }), { status: upstream.status });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection:      "keep-alive",
    },
  });
}
