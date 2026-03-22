import { NextResponse } from "next/server";
import { Client, Wallet, encode } from "xrpl";

// ── Credential constants ──────────────────────────────────────────────────────

const CRED_KYC_FULL = "4B59435F46554C4C";
const CRED_TIER1    = "4B59435F5449455231";
const CRED_TIER2    = "4B59435F5449455232";
const TIER_MAX      = { [CRED_TIER2]: 2000, [CRED_TIER1]: 500 };

// ── Loan parameters ───────────────────────────────────────────────────────────
// Flat-fee model: 8% origination fee deducted upfront, no amortized interest.
// Borrower receives principal × 0.92, repays principal in 3 equal installments.

const ORIGINATION_FEE_RATE = 0.08;   // 8% flat fee on principal
const LATE_INTEREST_RATE   = 50_000; // 5% annual penalty on overdue balance
const PAYMENT_TOTAL        = 3;
const PAYMENT_INTERVAL     = 300;    // 5 minutes (devnet demo)
const GRACE_PERIOD         = 60;     // 1 min (minimum; must be ≤ PaymentInterval)

// ── POST /api/loans/prepare ───────────────────────────────────────────────────
// Body:    { principalRLUSD: string, borrowerAddress: string }
// Returns: { tx: object } — prepared LoanSet ready for borrower signing

export async function POST(request) {
  try {
    const { principalRLUSD, borrowerAddress } = await request.json();

    const principal = parseFloat(principalRLUSD);
    if (!principal || principal <= 0 || !borrowerAddress) {
      return NextResponse.json({ error: "principalRLUSD and borrowerAddress required" }, { status: 400 });
    }

    const brokerSeed   = process.env.PLATFORM_BROKER_WALLET_SEED;
    const loanBrokerId = process.env.LOAN_BROKER_ID;
    const endpoint     = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";

    if (!brokerSeed || !loanBrokerId) {
      return NextResponse.json(
        { error: "Backend not configured — PLATFORM_BROKER_WALLET_SEED or LOAN_BROKER_ID missing. Run lending setup scripts first." },
        { status: 500 }
      );
    }

    const broker = Wallet.fromSeed(brokerSeed);
    const client = new Client(endpoint);
    await client.connect();

    try {
      // ── 1. Verify borrower KYC_FULL + tier ──────────────────────────────────
      const platformIssuer = process.env.PLATFORM_ISSUER_WALLET_ADDRESS;
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

      if (!types.has(CRED_KYC_FULL)) {
        return NextResponse.json(
          { error: "KYC_FULL credential required to request a loan." },
          { status: 403 }
        );
      }

      const tierHex   = types.has(CRED_TIER2) ? CRED_TIER2 : types.has(CRED_TIER1) ? CRED_TIER1 : null;
      const maxAmount = tierHex ? TIER_MAX[tierHex] : 0;
      if (!tierHex || principal > maxAmount) {
        return NextResponse.json(
          { error: `Loan amount exceeds your credit tier limit (${maxAmount} RLUSD).` },
          { status: 403 }
        );
      }

      // ── 2. Build LoanSet: Account = Borrower, Counterparty = Broker ─────────
      const originationFee = String(Math.round(principal * ORIGINATION_FEE_RATE * 100) / 100);

      const loanSetBase = {
        TransactionType:    "LoanSet",
        Account:            borrowerAddress,
        LoanBrokerID:       loanBrokerId,
        Counterparty:       broker.address,
        PrincipalRequested: String(principal),
        InterestRate:       0,
        LateInterestRate:   LATE_INTEREST_RATE,
        LoanOriginationFee: originationFee,
        PaymentTotal:       PAYMENT_TOTAL,
        PaymentInterval:    PAYMENT_INTERVAL,
        GracePeriod:        GRACE_PERIOD,
      };

      // Autofill (fee, sequence, last ledger sequence)
      const prepared = await client.autofill(loanSetBase);

      // Encode to hex so XUMM receives a txblob payload — bypasses
      // the payload validator that rejects unknown XLS-66 fields.
      const txBlob = encode(prepared);

      return NextResponse.json({ txBlob });
    } finally {
      await client.disconnect();
    }
  } catch (err) {
    console.error("[loans/prepare]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
