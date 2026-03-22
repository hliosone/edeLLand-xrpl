/**
 * POST /api/loans/collateral/confirm-deposit
 *
 * Body:    { loanRequestId: string, txHash: string }
 * Returns: { ok: true, xrpReceived }
 */

import { NextResponse }                       from "next/server";
import { Client }                             from "xrpl";
import { getById, confirmDeposit }            from "../../../../../lib/collateral-store.js";

export async function POST(request) {
  try {
    const { loanRequestId, txHash } = await request.json();

    if (!loanRequestId || !txHash) {
      return NextResponse.json({ error: "loanRequestId and txHash required" }, { status: 400 });
    }

    const position = getById(loanRequestId);
    if (!position) {
      return NextResponse.json({ error: "Unknown loanRequestId" }, { status: 404 });
    }
    if (position.status === "deposit_confirmed" || position.status === "active") {
      return NextResponse.json({ ok: true, xrpReceived: position.xrpDrops, alreadyConfirmed: true });
    }

    const escrowAddress = process.env.COLLATERAL_ESCROW_WALLET_ADDRESS;
    const endpoint      = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";
    const client        = new Client(endpoint);
    await client.connect();

    try {
      const txRes = await client.request({ command: "tx", transaction: txHash, binary: false });
      const tx    = txRes.result;
      const meta  = tx.meta ?? tx.metaData;

      if (!tx || meta?.TransactionResult !== "tesSUCCESS") {
        return NextResponse.json({ error: "Transaction not validated or failed." }, { status: 400 });
      }
      if (tx.TransactionType !== "Payment") {
        return NextResponse.json({ error: "Transaction is not a Payment." }, { status: 400 });
      }
      if (tx.Destination !== escrowAddress) {
        return NextResponse.json({ error: `Wrong destination (expected ${escrowAddress}).` }, { status: 400 });
      }
      if (tx.Account !== position.userAddress) {
        return NextResponse.json({ error: "Sender does not match borrower." }, { status: 400 });
      }

      const receivedDrops = BigInt(tx.Amount);
      const requiredDrops = BigInt(position.xrpDrops);
      if (receivedDrops < requiredDrops) {
        return NextResponse.json(
          { error: `Insufficient collateral: got ${receivedDrops} drops, need ${requiredDrops}.` },
          { status: 400 }
        );
      }

      confirmDeposit(loanRequestId, txHash);
      return NextResponse.json({ ok: true, xrpReceived: String(receivedDrops) });
    } finally {
      await client.disconnect();
    }
  } catch (err) {
    console.error("[collateral/confirm-deposit]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
