import { NextResponse } from "next/server";
import { Client } from "xrpl";

// ── POST /api/xrpl ────────────────────────────────────────────────────────────
// Proxies a single XRPL request to the configured node (local or devnet).
// Body: { method: string, params: object }
// Returns: { result: any } | { error: string }

export async function POST(request) {
  try {
    const { method, params } = await request.json();
    const endpoint = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";

    const client = new Client(endpoint);
    await client.connect();

    try {
      const result = await client.request({ command: method, ...params });
      return NextResponse.json({ result: result.result });
    } finally {
      await client.disconnect();
    }
  } catch (err) {
    console.error("[xrpl proxy]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
