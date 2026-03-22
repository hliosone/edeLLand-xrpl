/**
 * POST /api/admin/loans/liquidate
 *
 * Manual liquidation of a specific collateral position.
 * Moves locked XRP from escrow → broker wallet, then defaults the loan on-chain.
 *
 * Body:    { loanRequestId: string }
 * Returns: { ok, liquidationHash, defaultHash }
 */

import { NextResponse }                from "next/server";
import { Client, Wallet }              from "xrpl";
import { getById, liquidateLoan }      from "../../../../../lib/collateral-store.js";

export async function POST(request) {
  try {
    const { loanRequestId } = await request.json();
    if (!loanRequestId) {
      return NextResponse.json({ error: "loanRequestId required" }, { status: 400 });
    }

    const position = getById(loanRequestId);
    if (!position) {
      return NextResponse.json({ error: "Unknown loanRequestId." }, { status: 404 });
    }
    if (position.status === "liquidated") {
      return NextResponse.json({ error: "Position already liquidated." }, { status: 400 });
    }
    if (!["active", "deposit_confirmed"].includes(position.status)) {
      return NextResponse.json({ error: `Cannot liquidate a position with status '${position.status}'.` }, { status: 400 });
    }

    const escrowSeed = process.env.COLLATERAL_ESCROW_WALLET_SEED;
    const brokerSeed = process.env.LOAN_BROKER_WALLET_SEED ?? process.env.PLATFORM_ISSUER_WALLET_SEED;
    const endpoint   = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";

    if (!escrowSeed) {
      return NextResponse.json({ error: "COLLATERAL_ESCROW_WALLET_SEED not configured." }, { status: 500 });
    }

    const escrowWallet = Wallet.fromSeed(escrowSeed);
    const brokerWallet = brokerSeed ? Wallet.fromSeed(brokerSeed) : null;
    const destination  = brokerWallet?.address ?? escrowWallet.address;

    const client = new Client(endpoint);
    await client.connect();

    try {
      // ── 1. Move collateral from escrow → broker ───────────────────────────
      const payRes = await client.submitAndWait({
        TransactionType: "Payment",
        Account:         escrowWallet.address,
        Destination:     destination,
        Amount:          position.xrpDrops,
      }, { autofill: true, wallet: escrowWallet });

      if (payRes.result.meta?.TransactionResult !== "tesSUCCESS") {
        return NextResponse.json({ error: `Collateral sweep failed: ${payRes.result.meta?.TransactionResult}` }, { status: 400 });
      }

      const liquidationHash = payRes.result.hash;
      let defaultHash       = null;

      // ── 2. LoanManage(default) the loan ──────────────────────────────────
      if (brokerWallet && position.loanId) {
        try {
          const dmRes = await client.submitAndWait({
            TransactionType: "LoanManage",
            Account:         brokerWallet.address,
            LoanID:          position.loanId,
            Flags:           0x00010000, // tfLoanDefault
          }, { autofill: true, wallet: brokerWallet });
          defaultHash = dmRes.result.hash;
        } catch (e) {
          console.warn("[liquidate] LoanManage default failed (grace period may not have expired):", e.message);
        }
      }

      liquidateLoan(loanRequestId);

      return NextResponse.json({ ok: true, liquidationHash, defaultHash });
    } finally {
      await client.disconnect();
    }
  } catch (err) {
    console.error("[admin/loans/liquidate]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
