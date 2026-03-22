/**
 * POST /api/loans/collateral/request
 *
 * Step 1 of the collateral loan flow.
 * - Verifies KYC (KYC_OVER18 or KYC_FULL)
 * - Fetches current XRP/USD price from oracle
 * - Computes required XRP collateral (loan × 1.25 ÷ xrpUsd)
 * - Creates a pending position in the store
 *
 * Body:    { borrowerAddress: string, loanAmountRLUSD: string }
 * Returns: { loanRequestId, xrpDropsRequired, xrpRequired, xrpUsd, escrowAddress, needsMultisigSetup }
 */

import { NextResponse }    from "next/server";
import { Client }          from "xrpl";
import crypto              from "crypto";
import { createRequest }   from "../../../../../lib/collateral-store.js";

const CRED_KYC_FULL   = "4B59435F46554C4C";
const CRED_KYC_OVER18 = "4B59435F4F5645523138";
const CRED_TIER1      = "4B59435F5449455231";
const CRED_TIER2      = "4B59435F5449455232";
const TIER_MAX        = { [CRED_TIER2]: 2000, [CRED_TIER1]: 500 };

const COLLATERAL_RATIO   = 1.25;  // borrower must lock 125% of loan value in XRP
const BASE_INTEREST_RATE = 30_000;  // 3% annual in 1/10 bps
const MAX_INTEREST_RATE  = 200_000; // 20% annual in 1/10 bps

export async function POST(request) {
  try {
    const { borrowerAddress, loanAmountRLUSD } = await request.json();

    const principal = parseFloat(loanAmountRLUSD);
    if (!principal || principal <= 0 || !borrowerAddress) {
      return NextResponse.json({ error: "borrowerAddress and loanAmountRLUSD required" }, { status: 400 });
    }

    const endpoint       = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";
    const escrowAddress  = process.env.COLLATERAL_ESCROW_WALLET_ADDRESS;
    const oracleAccount  = process.env.NEXT_PUBLIC_ORACLE_ADDRESS;
    const oracleDocId    = parseInt(process.env.NEXT_PUBLIC_ORACLE_DOCUMENT_ID ?? "1", 10);
    const platformIssuer = process.env.PLATFORM_ISSUER_WALLET_ADDRESS;
    const vaultId        = process.env.PERMISSIONED_VAULT_ID;

    if (!escrowAddress) {
      return NextResponse.json(
        { error: "COLLATERAL_ESCROW_WALLET_ADDRESS not set — run setup script first." },
        { status: 500 }
      );
    }

    const client = new Client(endpoint);
    await client.connect();

    try {
      // ── 1. KYC check (KYC_OVER18 or KYC_FULL minimum) ──────────────────────
      const credsRes = await client.request({
        command:      "account_objects",
        account:      borrowerAddress,
        type:         "credential",
        ledger_index: "validated",
      });
      const accepted = (credsRes.result.account_objects ?? []).filter((c) => {
        const isAccepted = !!(c.Flags & 0x00010000);
        const fromUs     = !platformIssuer || c.Issuer === platformIssuer;
        return isAccepted && fromUs;
      });
      const types = new Set(accepted.map((c) => c.CredentialType));

      if (!types.has(CRED_KYC_FULL) && !types.has(CRED_KYC_OVER18)) {
        return NextResponse.json(
          { error: "KYC_OVER18 or KYC_FULL credential required to request a collateralised loan." },
          { status: 403 }
        );
      }

      // ── 2. Credit tier cap ────────────────────────────────────────────────
      const tierHex   = types.has(CRED_TIER2) ? CRED_TIER2 : types.has(CRED_TIER1) ? CRED_TIER1 : null;
      const maxAmount = tierHex ? TIER_MAX[tierHex] : 0;
      if (!tierHex || principal > maxAmount) {
        return NextResponse.json(
          { error: `Amount exceeds your credit tier limit (${maxAmount} RLUSD).` },
          { status: 403 }
        );
      }

      // ── 3. Fetch XRP/USD price from oracle ────────────────────────────────
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
      // Fallback: live price via Binance
      if (!xrpUsd) {
        try {
          const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=XRPUSDT");
          xrpUsd  = parseFloat((await r.json()).price);
        } catch {}
      }
      if (!xrpUsd || isNaN(xrpUsd)) {
        return NextResponse.json({ error: "Cannot fetch XRP/USD price. Oracle not configured." }, { status: 503 });
      }

      // ── 4. Compute required collateral in drops ───────────────────────────
      // health = (xrpDrops/1e6 * xrpUsd) / principal * 100  → target = COLLATERAL_RATIO * 100
      const xrpRequired      = (principal * COLLATERAL_RATIO) / xrpUsd;           // in XRP
      const xrpDropsRequired = String(Math.ceil(xrpRequired * 1_000_000));         // ceil to drops

      // ── 5. Fetch vault utilization → dynamic interest rate preview ─────────
      let dynamicInterestRate = BASE_INTEREST_RATE;
      if (vaultId) {
        try {
          const vaultEntry = await client.request({ command: "ledger_entry", index: vaultId, ledger_index: "validated" });
          const vault = vaultEntry.result.node;
          const assetsTotal     = parseFloat(vault.AssetsTotal?.value     ?? vault.AssetsTotal     ?? "0");
          const assetsAvailable = parseFloat(vault.AssetsAvailable?.value ?? vault.AssetsAvailable ?? "0");
          if (assetsTotal > 0) {
            const utilization = Math.max(0, Math.min(1, 1 - assetsAvailable / assetsTotal));
            dynamicInterestRate = Math.round(BASE_INTEREST_RATE + utilization * (MAX_INTEREST_RATE - BASE_INTEREST_RATE));
          }
        } catch { /* keep base rate */ }
      }
      const interestRatePct = dynamicInterestRate / 10_000; // e.g. 30,000 → 3.0 (%)

      // ── 6. Create store entry ─────────────────────────────────────────────
      const loanRequestId = crypto.randomUUID();
      createRequest({
        loanRequestId,
        userAddress:     borrowerAddress,
        xrpDrops:        xrpDropsRequired,
        loanAmountRLUSD: String(principal),
      });

      return NextResponse.json({
        loanRequestId,
        xrpDropsRequired,
        xrpRequired:    xrpRequired.toFixed(6),
        xrpUsd,
        escrowAddress,
        interestRatePct,
      });
    } finally {
      await client.disconnect();
    }
  } catch (err) {
    console.error("[collateral/request]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
