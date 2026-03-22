/**
 * POST /api/loans/collateral/prepare-deposit
 *
 * Builds and autofills the collateral Payment tx so Xaman can sign it.
 *
 * Body:    { borrowerAddress: string, loanRequestId: string }
 * Returns: { txJson: object }
 */

import { NextResponse } from "next/server";
import { Client }       from "xrpl";
import { getById }      from "../../../../../lib/collateral-store.js";

export async function POST(request) {
  try {
    const { borrowerAddress, loanRequestId } = await request.json();

    if (!borrowerAddress || !loanRequestId) {
      return NextResponse.json({ error: "borrowerAddress and loanRequestId required" }, { status: 400 });
    }

    const position = getById(loanRequestId);
    if (!position) {
      return NextResponse.json({ error: "Unknown loanRequestId" }, { status: 404 });
    }
    if (position.userAddress !== borrowerAddress) {
      return NextResponse.json({ error: "loanRequestId does not belong to this address." }, { status: 403 });
    }

    const escrowAddress = process.env.COLLATERAL_ESCROW_WALLET_ADDRESS;
    const endpoint      = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";

    if (!escrowAddress) {
      return NextResponse.json({ error: "COLLATERAL_ESCROW_WALLET_ADDRESS not configured." }, { status: 500 });
    }

    const client = new Client(endpoint);
    await client.connect();

    try {
      const txJson = await client.autofill({
        TransactionType: "Payment",
        Account:         borrowerAddress,
        Destination:     escrowAddress,
        Amount:          position.xrpDrops,
      });

      return NextResponse.json({ txJson });
    } finally {
      await client.disconnect();
    }
  } catch (err) {
    console.error("[collateral/prepare-deposit]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
