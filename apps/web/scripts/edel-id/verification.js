/**
 * Edel-ID verification scripts
 * - start: proxied via Next.js (/api/edel-id/start)
 * - watch: calls verifier.edel-id.ch directly to avoid Next.js route timeout
 */

const EDEL_ID_BASE = "https://verifier.edel-id.ch";

export const CLAIMS_FULL    = ["$.age_over_18", "$.given_name", "$.family_name", "$.nationality"];
export const CLAIMS_MINIMAL = ["$.age_over_18", "$.nationality"];

// backward-compat alias
export const CLAIMS = CLAIMS_FULL;

/**
 * Start a new Edel-ID verification session.
 * @param {"full"|"minimal"} flow
 * @param {string|null} walletAddress  XRP address for AML/OFAC screening
 * @returns {{ id: string, verification_url: string }}
 */
export async function startVerification(flow = "full", walletAddress = null) {
  const res = await fetch("/api/edel-id/start", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ flow, walletAddress }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (data.error === "AML_BLOCKED") {
      const err = new Error("AML_BLOCKED");
      err.amlBlocked = true;
      err.amlLabel   = data.label;
      err.amlSource  = data.source;
      throw err;
    }
    throw new Error(`Start verification failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Subscribe to the SSE stream for a verification session.
 * @param {string} id
 * @param {(data: object) => void} onData
 * @param {"full"|"minimal"} flow
 * @returns {Promise<object>}
 */
export async function watchVerification(id, onData, flow = "full") {
  const claims = flow === "minimal" ? CLAIMS_MINIMAL : CLAIMS_FULL;

  const res = await fetch(`${EDEL_ID_BASE}/api/verification/${id}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body:    JSON.stringify({ verificationClaims: claims }),
  });
  if (!res.ok) throw new Error(`SSE connection failed: ${res.status}`);

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer    = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.substring(5).trim();
      if (!raw) continue;
      try {
        const data = JSON.parse(raw);
        onData(data);
        if (data.state === "SUCCESS" || data.state === "FAILED") {
          reader.cancel();
          return data;
        }
      } catch {
        // ignore malformed lines
      }
    }
  }

  throw new Error("SSE stream ended without final state");
}
