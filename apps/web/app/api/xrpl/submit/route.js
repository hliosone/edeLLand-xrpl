import { Client } from "xrpl";
import { NextResponse } from "next/server";

// POST /api/xrpl/submit
// Body: { txBlob: string }
// Returns: { txHash, result }
export async function POST(request) {
  const { txBlob } = await request.json();

  if (!txBlob) {
    return NextResponse.json({ error: "txBlob is required" }, { status: 400 });
  }

  const endpoint = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";
  const client = new Client(endpoint);

  try {
    await client.connect();
    const result = await client.submitAndWait(txBlob);
    return NextResponse.json({
      txHash: result.result.hash,
      result: result.result.meta?.TransactionResult,
    });
  } catch (err) {
    console.error("[xrpl/submit]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    await client.disconnect();
  }
}
