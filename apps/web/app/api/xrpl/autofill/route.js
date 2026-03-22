import { Client } from "xrpl";
import { NextResponse } from "next/server";

// POST /api/xrpl/autofill
// Body: { tx: object }
// Returns: { tx: autofilled_object }
export async function POST(request) {
  const { tx } = await request.json();

  if (!tx || !tx.TransactionType || !tx.Account) {
    return NextResponse.json({ error: "tx with TransactionType and Account is required" }, { status: 400 });
  }

  const endpoint = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";
  const client = new Client(endpoint);

  try {
    await client.connect();
    const prepared = await client.autofill(tx);
    return NextResponse.json({ tx: prepared });
  } catch (err) {
    console.error("[xrpl/autofill]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    await client.disconnect();
  }
}
