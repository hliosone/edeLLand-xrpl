/**
 * POST /api/loans/collateral/release
 *
 * Platform-only endpoint. Finalises a collateral escrow after the on-chain
 * Loan is either fully repaid or liquidated.
 *
 * action = "repay"
 *   - EscrowFinish from the escrow wallet → XRP lands at escrow wallet
 *   - Then a Payment from escrow wallet → borrower returns the XRP to them
 *
 * action = "liquidate"
 *   - EscrowFinish from the escrow wallet → XRP lands at escrow wallet (kept)
 *   - Marks position as liquidated in the store
 *
 * Body:    { loanRequestId: string, action: "repay" | "liquidate" }
 * Returns: { ok: true, finishHash, refundHash? }
 */

import { NextResponse }                from "next/server";
import { Client, Wallet }             from "xrpl";
import { getById, releaseLoan, liquidateLoan } from "../../../../../lib/collateral-store.js";

export async function POST(request) {
  try {
    const { loanRequestId, action } = await request.json();

    if (!loanRequestId || !["repay", "liquidate"].includes(action)) {
      return NextResponse.json(
        { error: "loanRequestId and action ('repay' | 'liquidate') required" },
        { status: 400 }
      );
    }

    const position = getById(loanRequestId);
    if (!position) {
      return NextResponse.json({ error: "Unknown loanRequestId." }, { status: 404 });
    }
    if (!["deposit_confirmed", "active"].includes(position.status)) {
      return NextResponse.json(
        { error: `Cannot release escrow with status '${position.status}'.` },
        { status: 400 }
      );
    }
    if (!position.escrowSequence) {
      return NextResponse.json(
        { error: "No escrow sequence stored for this position — was the deposit an EscrowCreate?" },
        { status: 400 }
      );
    }
    if (!position.escrowFulfillment) {
      return NextResponse.json({ error: "No escrow fulfillment stored." }, { status: 500 });
    }

    const escrowSeed    = process.env.COLLATERAL_ESCROW_WALLET_SEED;
    const escrowAddress = process.env.COLLATERAL_ESCROW_WALLET_ADDRESS;
    const endpoint      = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";

    if (!escrowSeed || !escrowAddress) {
      return NextResponse.json(
        { error: "COLLATERAL_ESCROW_WALLET_SEED / COLLATERAL_ESCROW_WALLET_ADDRESS not configured." },
        { status: 500 }
      );
    }

    const escrowWallet = Wallet.fromSeed(escrowSeed);
    const client       = new Client(endpoint);
    await client.connect();

    try {
      // ── 1. EscrowFinish — platform releases the escrow ────────────────────
      const finishTx = {
        TransactionType: "EscrowFinish",
        Account:         escrowAddress,
        Owner:           position.userAddress,
        OfferSequence:   position.escrowSequence,
        Condition:       position.escrowCondition,
        Fulfillment:     position.escrowFulfillment,
      };

      const finishFilled = await client.autofill(finishTx);
      const { tx_blob: finishBlob } = escrowWallet.sign(finishFilled);
      const finishRes  = await client.submitAndWait(finishBlob);
      const finishResult = finishRes.result.meta?.TransactionResult;

      if (finishResult !== "tesSUCCESS") {
        return NextResponse.json({ error: `EscrowFinish failed: ${finishResult}` }, { status: 400 });
      }

      const finishHash = finishRes.result.hash;

      // ── 2. On repayment: refund XRP back to borrower ──────────────────────
      let refundHash = null;
      if (action === "repay") {
        const refundTx = {
          TransactionType: "Payment",
          Account:         escrowAddress,
          Destination:     position.userAddress,
          Amount:          position.xrpDrops,
        };
        const refundFilled = await client.autofill(refundTx);
        const { tx_blob: refundBlob } = escrowWallet.sign(refundFilled);
        const refundRes    = await client.submitAndWait(refundBlob);
        const refundResult = refundRes.result.meta?.TransactionResult;
        if (refundResult !== "tesSUCCESS") {
          // Escrow was finished but refund failed — log and surface as partial success
          console.error("[collateral/release] Refund payment failed:", refundResult);
          return NextResponse.json(
            { ok: false, finishHash, error: `Escrow finished but XRP refund failed: ${refundResult}` },
            { status: 500 }
          );
        }
        refundHash = refundRes.result.hash;
        releaseLoan(loanRequestId);
      } else {
        // liquidate — XRP stays with escrow wallet
        liquidateLoan(loanRequestId);
      }

      return NextResponse.json({ ok: true, finishHash, refundHash });
    } finally {
      await client.disconnect();
    }
  } catch (err) {
    console.error("[collateral/release]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
