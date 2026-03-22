/**
 * POST /api/loans/collateral/prepare
 *
 * Step 4 of the collateral loan flow.
 * Same as /api/loans/prepare but:
 *   - Accepts KYC_OVER18 OR KYC_FULL (collateral compensates for lighter KYC)
 *   - Verifies that a deposit_confirmed position exists for the borrower
 *   - Uses a dynamic interest rate based on vault utilization
 *
 * Body:    { borrowerAddress: string, loanRequestId: string }
 * Returns: { txJson: object, interestRatePct: number } — LoanSet ready for borrower signing via txjson
 */

import { NextResponse }                   from "next/server";
import { Client, Wallet }                 from "xrpl";
import { getById }                        from "../../../../../lib/collateral-store.js";

const CRED_KYC_FULL   = "4B59435F46554C4C";
const CRED_KYC_OVER18 = "4B59435F4F5645523138";
const CRED_TIER1      = "4B59435F5449455231";
const CRED_TIER2      = "4B59435F5449455232";
const TIER_MAX        = { [CRED_TIER2]: 2000, [CRED_TIER1]: 500 };

const ORIGINATION_FEE_RATE = 0.08;
const LATE_INTEREST_RATE   = 50_000; // 5% annual in 1/10th bps
const PAYMENT_TOTAL        = 3;
const PAYMENT_INTERVAL     = 300;   // 5 min (devnet)
const GRACE_PERIOD         = 60;    // 1 min (devnet)

// ── Dynamic interest rate ────────────────────────────────────────────────────
// Scales linearly with vault utilization: 3% at 0% utilization → 20% at 100%.
// Units: 1/10 bps (10,000 = 1% annual, 50,000 = 5% annual).
const BASE_INTEREST_RATE = 30_000;  // 3% annual
const MAX_INTEREST_RATE  = 200_000; // 20% annual

export async function POST(request) {
  try {
    const { borrowerAddress, loanRequestId } = await request.json();

    if (!borrowerAddress || !loanRequestId) {
      return NextResponse.json({ error: "borrowerAddress and loanRequestId required" }, { status: 400 });
    }

    // ── 1. Verify collateral deposit is confirmed ─────────────────────────────
    const position = getById(loanRequestId);
    if (!position) {
      return NextResponse.json({ error: "Unknown loanRequestId." }, { status: 404 });
    }
    if (position.userAddress !== borrowerAddress) {
      return NextResponse.json({ error: "loanRequestId does not belong to this address." }, { status: 403 });
    }
    if (position.status !== "deposit_confirmed") {
      return NextResponse.json(
        { error: `Collateral not yet confirmed (status: ${position.status}). Complete the deposit step first.` },
        { status: 400 }
      );
    }

    const brokerSeed    = process.env.LOAN_BROKER_WALLET_SEED ?? process.env.PLATFORM_ISSUER_WALLET_SEED;
    const loanBrokerId  = process.env.LOAN_BROKER_ID;
    const vaultId       = process.env.PERMISSIONED_VAULT_ID;
    const endpoint      = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";
    const platformIssuer = process.env.PLATFORM_ISSUER_WALLET_ADDRESS;

    if (!brokerSeed || !loanBrokerId) {
      return NextResponse.json(
        { error: "Backend not configured — run lending setup scripts first." },
        { status: 500 }
      );
    }

    const broker = Wallet.fromSeed(brokerSeed);
    const client = new Client(endpoint);
    await client.connect();

    try {
      // ── 2. Fetch vault utilization → dynamic interest rate ───────────────
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

      // ── 3. KYC check (KYC_OVER18 or KYC_FULL) ────────────────────────────
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
          { error: "KYC_OVER18 or KYC_FULL credential required." },
          { status: 403 }
        );
      }

      const tierHex   = types.has(CRED_TIER2) ? CRED_TIER2 : types.has(CRED_TIER1) ? CRED_TIER1 : null;
      const principal = parseFloat(position.loanAmountRLUSD);
      const maxAmount = tierHex ? TIER_MAX[tierHex] : 0;
      if (!tierHex || principal > maxAmount) {
        return NextResponse.json(
          { error: `Loan amount exceeds your credit tier limit (${maxAmount} RLUSD).` },
          { status: 403 }
        );
      }

      // ── 4. Build LoanSet TX — PrincipalRequested / LoanOriginationFee are STNumber
      //    (XLS-66 type = 64-bit IEEE double as decimal string, NOT an IOU object)
      const originationFeeValue = String(Math.round(principal * ORIGINATION_FEE_RATE));

      const loanSetBase = {
        TransactionType:    "LoanSet",
        Account:            borrowerAddress,
        LoanBrokerID:       loanBrokerId,
        Counterparty:       broker.address,
        PrincipalRequested: String(principal),
        InterestRate:       dynamicInterestRate,
        LateInterestRate:   LATE_INTEREST_RATE,
        LoanOriginationFee: originationFeeValue,
        PaymentTotal:       PAYMENT_TOTAL,
        PaymentInterval:    PAYMENT_INTERVAL,
        GracePeriod:        GRACE_PERIOD,
      };

      const txJson = await client.autofill(loanSetBase);

      return NextResponse.json({ txJson, interestRatePct });
    } finally {
      await client.disconnect();
    }
  } catch (err) {
    console.error("[collateral/prepare]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
