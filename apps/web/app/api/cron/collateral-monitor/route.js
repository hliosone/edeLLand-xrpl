/**
 * GET /api/cron/collateral-monitor
 *
 * Checks ALL active collateral positions across all users.
 * Auto-liquidates any position whose health drops below COLLATERAL_LIQUIDATION_THRESHOLD.
 *
 * Called by:
 *  - Client polling (every 30 s on the loans dashboard)
 *  - Can also be hit by an external cron / uptime monitor
 *
 * Health formula:
 *   health% = (xrpLocked * xrpUsd) / TotalValueOutstanding * 100
 *
 * Returns: { checked, liquidated, warnings, xrpUsd, results[] }
 */

import { NextResponse }                             from "next/server";
import { Client, Wallet }                           from "xrpl";
import { getAllActive, liquidateLoan, releaseLoan }  from "../../../../lib/collateral-store.js";

export const dynamic = "force-dynamic"; // never cached

const WARNING_THRESHOLD     = parseFloat(process.env.COLLATERAL_WARNING_THRESHOLD     ?? "120");
const LIQUIDATION_THRESHOLD = parseFloat(process.env.COLLATERAL_LIQUIDATION_THRESHOLD ?? "112");

export async function GET() {
  try {
    const positions = getAllActive();
    if (!positions.length) {
      return NextResponse.json({ checked: 0, liquidated: 0, warnings: 0, xrpUsd: null, results: [] });
    }

    const endpoint      = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";
    const oracleAccount = process.env.NEXT_PUBLIC_ORACLE_ADDRESS;
    const oracleDocId   = parseInt(process.env.NEXT_PUBLIC_ORACLE_DOCUMENT_ID ?? "1", 10);
    const escrowSeed    = process.env.COLLATERAL_ESCROW_WALLET_SEED;
    const brokerSeed    = process.env.LOAN_BROKER_WALLET_SEED ?? process.env.PLATFORM_ISSUER_WALLET_SEED;

    const client = new Client(endpoint);
    await client.connect();

    try {
      // ── 1. XRP/USD price ─────────────────────────────────────────────────
      let xrpUsd = null;
      if (oracleAccount) {
        try {
          const r = await client.request({
            command:      "get_aggregate_price",
            ledger_index: "current",
            base_asset:   "XRP",
            quote_asset:  "USD",
            oracles:      [{ account: oracleAccount, oracle_document_id: oracleDocId }],
          });
          xrpUsd = parseFloat(r.result.entire_set?.mean);
        } catch {}
      }
      if (!xrpUsd) {
        try {
          const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=XRPUSDT");
          xrpUsd  = parseFloat((await r.json()).price);
        } catch {}
      }
      if (!xrpUsd || isNaN(xrpUsd)) {
        return NextResponse.json({ error: "Cannot fetch XRP/USD price." }, { status: 503 });
      }

      // ── 2. Process each position ──────────────────────────────────────────
      const results        = [];
      let liquidatedCount  = 0;
      let warningCount     = 0;

      for (const pos of positions) {
        let outstandingRLUSD = parseFloat(pos.loanAmountRLUSD);
        let loanRepaid       = false;

        if (pos.loanId) {
          try {
            const le   = await client.request({ command: "ledger_entry", index: pos.loanId, ledger_index: "validated" });
            const loan = le.result.node;
            if (loan?.PaymentRemaining === 0) {
              loanRepaid = true;
              outstandingRLUSD = 0;
            } else {
              outstandingRLUSD = parseFloat(loan?.TotalValueOutstanding ?? outstandingRLUSD);
            }
          } catch {}
        }

        // ── Auto-release if loan fully repaid ─────────────────────────────
        if (loanRepaid) {
          if (escrowSeed) {
            try {
              const escrowWallet = Wallet.fromSeed(escrowSeed);
              await client.submitAndWait({
                TransactionType: "Payment",
                Account:         escrowWallet.address,
                Destination:     pos.userAddress,
                Amount:          pos.xrpDrops,
              }, { autofill: true, wallet: escrowWallet });
            } catch (e) {
              console.error(`[monitor] release collateral failed for ${pos.loanRequestId}:`, e.message);
            }
          }
          releaseLoan(pos.loanRequestId);
          results.push({ loanRequestId: pos.loanRequestId, action: "released", health: null });
          continue;
        }

        const xrpLocked = parseInt(pos.xrpDrops) / 1_000_000;
        const health    = outstandingRLUSD > 0
          ? parseFloat(((xrpLocked * xrpUsd) / outstandingRLUSD * 100).toFixed(2))
          : null;

        // ── Auto-liquidate if below threshold ─────────────────────────────
        if (health !== null && health < LIQUIDATION_THRESHOLD) {
          let liquidationHash = null;
          let defaultHash     = null;

          if (escrowSeed) {
            try {
              const escrowWallet  = Wallet.fromSeed(escrowSeed);
              const brokerWallet  = brokerSeed ? Wallet.fromSeed(brokerSeed) : null;
              const destination   = brokerWallet?.address ?? escrowWallet.address;

              // 1. Move collateral from escrow → broker
              const payRes = await client.submitAndWait({
                TransactionType: "Payment",
                Account:         escrowWallet.address,
                Destination:     destination,
                Amount:          pos.xrpDrops,
              }, { autofill: true, wallet: escrowWallet });
              liquidationHash = payRes.result.hash;

              // 2. LoanManage → default the loan
              if (brokerWallet && pos.loanId) {
                const nowRipple = Math.floor(Date.now() / 1000) - 946684800;
                try {
                  const dmRes = await client.submitAndWait({
                    TransactionType: "LoanManage",
                    Account:         brokerWallet.address,
                    LoanID:          pos.loanId,
                    Flags:           0x00010000, // tfLoanDefault
                  }, { autofill: true, wallet: brokerWallet });
                  defaultHash = dmRes.result.hash;
                } catch (e) {
                  console.warn(`[monitor] LoanManage default failed (may need to wait for grace period):`, e.message);
                }
              }
            } catch (e) {
              console.error(`[monitor] liquidation failed for ${pos.loanRequestId}:`, e.message);
            }
          }

          liquidateLoan(pos.loanRequestId);
          liquidatedCount++;
          results.push({
            loanRequestId: pos.loanRequestId,
            action:        "liquidated",
            health,
            liquidationHash,
            defaultHash,
          });
        } else {
          if (health !== null && health < WARNING_THRESHOLD) warningCount++;
          results.push({
            loanRequestId: pos.loanRequestId,
            action:        health !== null && health < WARNING_THRESHOLD ? "warning" : "ok",
            health,
          });
        }
      }

      return NextResponse.json({
        checked:    positions.length,
        liquidated: liquidatedCount,
        warnings:   warningCount,
        xrpUsd,
        results,
      });
    } finally {
      await client.disconnect();
    }
  } catch (err) {
    console.error("[cron/collateral-monitor]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
