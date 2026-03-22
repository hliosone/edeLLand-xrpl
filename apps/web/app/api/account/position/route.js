import { Client } from "xrpl";
import { NextResponse } from "next/server";

const NETWORK = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";
const ENV_MPT_ID = process.env.NEXT_PUBLIC_MPT_ISSUANCE_ID ?? null;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");
  if (!address) return NextResponse.json({ error: "address required" }, { status: 400 });

  const client = new Client(NETWORK);
  try {
    await client.connect();

    const res     = await client.request({ command: "account_objects", account: address, type: "mptoken", ledger_index: "validated" });
    const objects = res.result.account_objects ?? [];

    const lp = ENV_MPT_ID
      ? (objects.find(o => o.MPTokenIssuanceID === ENV_MPT_ID) ?? objects[0])
      : objects[0];

    return NextResponse.json({
      lpBalance:  lp?.MPTAmount        ?? "0",
      issuanceId: lp?.MPTokenIssuanceID ?? null,
    });
  } catch (err) {
    if (err?.data?.error === "actNotFound" || err?.message?.includes("actNotFound")) {
      return NextResponse.json({ lpBalance: "0", issuanceId: null });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    await client.disconnect();
  }
}
