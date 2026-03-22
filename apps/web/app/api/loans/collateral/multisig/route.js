/**
 * POST /api/loans/collateral/multisig
 *
 * Step 2 of the collateral loan flow (first-time only).
 * Builds a SignerListSet TX on the borrower's own wallet:
 *   - Escrow wallet (platform): weight 2  ← dominant signer
 *   - Borrower:                weight 1
 *   - SignerQuorum: 2          ← platform can act alone; borrower cannot
 *
 * The borrower's master key is NOT disabled — Xaman still works normally.
 * The multi-sig is a consent/enforcement layer: platform can sign from
 * the borrower's wallet if ever needed (e.g., emergency enforcement).
 *
 * Body:    { borrowerAddress: string, loanRequestId: string }
 * Returns: { txJson: object }  — ready for walletManager.signAndSubmit(txJson) in Xaman
 *
 * After user signs → call POST /api/loans/collateral/multisig/confirm
 * (same route, action: "confirm") to mark multisigDone in the store.
 */

import { NextResponse }       from "next/server";
import { Client }             from "xrpl";
import { confirmMultisig }    from "../../../../../lib/collateral-store.js";

export async function POST(request) {
  try {
    const body = await request.json();

    // ── "confirm" action — called after Xaman returns the signed TX ──────────
    if (body.action === "confirm") {
      const { loanRequestId } = body;
      if (!loanRequestId) {
        return NextResponse.json({ error: "loanRequestId required" }, { status: 400 });
      }
      confirmMultisig(loanRequestId);
      return NextResponse.json({ ok: true });
    }

    // ── Default: build the SignerListSet TX blob ──────────────────────────────
    const { borrowerAddress, loanRequestId } = body;
    if (!borrowerAddress || !loanRequestId) {
      return NextResponse.json({ error: "borrowerAddress and loanRequestId required" }, { status: 400 });
    }

    const escrowAddress = process.env.COLLATERAL_ESCROW_WALLET_ADDRESS;
    if (!escrowAddress) {
      return NextResponse.json(
        { error: "COLLATERAL_ESCROW_WALLET_ADDRESS not configured." },
        { status: 500 }
      );
    }

    const endpoint = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";
    const client   = new Client(endpoint);
    await client.connect();

    try {
      const tx = {
        TransactionType: "SignerListSet",
        Account:         borrowerAddress,
        SignerQuorum:    2,
        SignerEntries: [
          { SignerEntry: { Account: escrowAddress,    SignerWeight: 2 } },
          { SignerEntry: { Account: borrowerAddress,  SignerWeight: 1 } },
        ],
      };

      const txJson = await client.autofill(tx);

      return NextResponse.json({ txJson });
    } finally {
      await client.disconnect();
    }
  } catch (err) {
    console.error("[collateral/multisig]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
