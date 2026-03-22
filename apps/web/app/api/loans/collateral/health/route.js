/**
 * GET /api/loans/collateral/health?userAddress=<addr>
 *
 * Computes collateral health for all active positions of a user.
 *
 * Formula:
 *   health% = (xrpLocked * xrpUsd) / TotalValueOutstanding * 100
 *
 * Thresholds (env-configurable):
 *   COLLATERAL_WARNING_THRESHOLD     default 120
 *   COLLATERAL_LIQUIDATION_THRESHOLD default 112
 *
 * Returns: {
 *   xrpUsd: number,
 *   positions: Array<{
 *     loanRequestId, loanId, userAddress,
 *     xrpLocked,            // XRP (not drops)
 *     outstandingRLUSD,
 *     health,               // float %
 *     warning,              // health < WARNING_THRESHOLD
 *     critical,             // health < LIQUIDATION_THRESHOLD
 *     status,
 *   }>
 * }
 */

import { NextResponse }       from "next/server";
import { Client }             from "xrpl";
import { getAllActive, getActiveByUser } from "../../../../../lib/collateral-store.js";

const WARNING_THRESHOLD     = parseFloat(process.env.COLLATERAL_WARNING_THRESHOLD     ?? "120");
const LIQUIDATION_THRESHOLD = parseFloat(process.env.COLLATERAL_LIQUIDATION_THRESHOLD ?? "112");

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userAddress      = searchParams.get("userAddress");

    const positions = userAddress ? getActiveByUser(userAddress) : getAllActive();

    if (!positions.length) {
      return NextResponse.json({ xrpUsd: null, positions: [] });
    }

    const endpoint      = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";
    const oracleAccount = process.env.NEXT_PUBLIC_ORACLE_ADDRESS;
    const oracleDocId   = parseInt(process.env.NEXT_PUBLIC_ORACLE_DOCUMENT_ID ?? "1", 10);
    const client        = new Client(endpoint);
    await client.connect();

    try {
      // ── 1. Fetch XRP/USD price ────────────────────────────────────────────
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

      // ── 2. For each active position, fetch loan outstanding ───────────────
      const results = await Promise.all(
        positions.map(async (pos) => {
          let outstandingRLUSD = null;

          if (pos.loanId) {
            try {
              const le = await client.request({
                command:      "ledger_entry",
                index:        pos.loanId,
                ledger_index: "validated",
              });
              const loan = le.result.node;
              // Loan fully repaid → outstanding = 0
              if (loan?.PaymentRemaining === 0) {
                outstandingRLUSD = 0;
              } else {
                outstandingRLUSD = parseFloat(loan?.TotalValueOutstanding ?? "0");
              }
            } catch {}
          }

          // Fallback to original loan amount if loan not yet on-chain
          if (outstandingRLUSD == null) {
            outstandingRLUSD = parseFloat(pos.loanAmountRLUSD);
          }

          const xrpLocked = parseInt(pos.xrpDrops) / 1_000_000;
          let health      = null;

          if (xrpUsd && outstandingRLUSD > 0) {
            health = (xrpLocked * xrpUsd) / outstandingRLUSD * 100;
          }

          return {
            loanRequestId:   pos.loanRequestId,
            loanId:          pos.loanId,
            userAddress:     pos.userAddress,
            xrpLocked:       xrpLocked.toFixed(6),
            outstandingRLUSD: outstandingRLUSD?.toFixed(6) ?? null,
            health:          health != null ? parseFloat(health.toFixed(2)) : null,
            warning:         health != null && health < WARNING_THRESHOLD,
            critical:        health != null && health < LIQUIDATION_THRESHOLD,
            status:          pos.status,
          };
        })
      );

      return NextResponse.json({ xrpUsd, positions: results });
    } finally {
      await client.disconnect();
    }
  } catch (err) {
    console.error("[collateral/health]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
