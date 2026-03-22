import { Client } from "xrpl";
import { NextResponse } from "next/server";

// Hex values for credential types
const HEX = {
  KYC_FULL:  "4B59435F46554C4C",
  KYC_TIER1: "4B59435F5449455231",
  KYC_TIER2: "4B59435F5449455232",
};

// Max loan amounts per tier (RLUSD)
export const TIER_MAX = {
  KYC_TIER2: 2000,
  KYC_TIER1: 500,
};

const NETWORK = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";

// GET /api/checkout/verify?address=r...
// Returns { hasFull, tier, maxAmount, error? }

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const address          = searchParams.get("address");

  if (!address) return NextResponse.json({ error: "address required" }, { status: 400 });

  const platformIssuer = process.env.PLATFORM_ISSUER_WALLET_ADDRESS;
  const client         = new Client(NETWORK);

  try {
    await client.connect();

    const res = await client.request({
      command:      "account_objects",
      account:      address,
      type:         "credential",
      ledger_index: "validated",
    });

    const objects = res.result.account_objects ?? [];

    // Keep only accepted credentials issued by the platform
    const accepted = objects.filter((c) => {
      const isAccepted = !!(c.Flags & 0x00010000);
      const fromUs     = !platformIssuer || c.Issuer === platformIssuer;
      return isAccepted && fromUs;
    });

    const types  = new Set(accepted.map((c) => c.CredentialType));
    const hasFull  = types.has(HEX.KYC_FULL);
    const hasTier2 = types.has(HEX.KYC_TIER2);
    const hasTier1 = types.has(HEX.KYC_TIER1);

    const tier      = hasTier2 ? "KYC_TIER2" : hasTier1 ? "KYC_TIER1" : null;
    const maxAmount = tier ? TIER_MAX[tier] : 0;

    return NextResponse.json({ hasFull, tier, maxAmount });
  } catch (err) {
    if (err?.data?.error === "actNotFound" || err?.message?.includes("actNotFound")) {
      return NextResponse.json({ hasFull: false, tier: null, maxAmount: 0 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    await client.disconnect();
  }
}
