import { NextResponse } from "next/server";
import { Client, Wallet, signLoanSetByCounterparty } from "xrpl";

// ── Credential constants ──────────────────────────────────────────────────────

const CRED_KYC_FULL = "4B59435F46554C4C";
const CRED_TIER1    = "4B59435F5449455231";
const CRED_TIER2    = "4B59435F5449455232";
const TIER_MAX      = { [CRED_TIER2]: 2000, [CRED_TIER1]: 500 };

const PAYMENT_TOTAL = 3;

function roundUpByScale(value, loanScale) {
  const factor = Math.pow(10, -loanScale);
  return (Math.ceil(value * factor) / factor).toFixed(Math.max(0, -loanScale));
}

// ── POST /api/loans/create ────────────────────────────────────────────────────
// Body:    { signedBlob: string, borrowerAddress: string }
// Returns: { ok, hash, loanId, periodicPayment, nextPaymentDueDate, paymentsTotal }
//
// Flow:
//  1. /api/loans/prepare → encoded txBlob (unsigned LoanSet)
//  2. User signs via Xaman txblob mode (adds TxnSignature) → signedBlob
//  3. Broker adds CounterpartySignature via signLoanSetByCounterparty → submit.

export async function POST(request) {
  try {
    const { signedBlob, borrowerAddress } = await request.json();

    if (!signedBlob || !borrowerAddress) {
      return NextResponse.json(
        { error: "signedBlob and borrowerAddress required" },
        { status: 400 }
      );
    }

    const brokerSeed   = process.env.LOAN_BROKER_WALLET_SEED ?? process.env.PLATFORM_ISSUER_WALLET_SEED;
    const loanBrokerId = process.env.LOAN_BROKER_ID;
    const endpoint     = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";

    if (!brokerSeed || !loanBrokerId) {
      return NextResponse.json(
        { error: "Backend not configured — LOAN_BROKER_WALLET_SEED or LOAN_BROKER_ID missing." },
        { status: 500 }
      );
    }

    const broker = Wallet.fromSeed(brokerSeed);
    const client = new Client(endpoint);
    await client.connect();

    try {
      // ── 1. KYC check on the connected wallet ─────────────────────────────────
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

      const tierHex = types.has(CRED_TIER2) ? CRED_TIER2 : types.has(CRED_TIER1) ? CRED_TIER1 : null;
      if (!tierHex) {
        return NextResponse.json(
          { error: "No credit tier credential found." },
          { status: 403 }
        );
      }

      // ── 2. Broker adds CounterpartySignature to the borrower-signed blob ──────
      const { tx_blob: finalBlob } = signLoanSetByCounterparty(broker, signedBlob);

      // ── 3. Submit ─────────────────────────────────────────────────────────────
      const res    = await client.submitAndWait(finalBlob);
      const result = res.result.meta?.TransactionResult;
      if (result !== "tesSUCCESS") {
        return NextResponse.json({ error: `LoanSet failed: ${result}` }, { status: 400 });
      }

      // ── 4. Fetch created Loan object ──────────────────────────────────────────
      const loansRes = await client.request({
        command:      "account_objects",
        account:      borrowerAddress,
        type:         "loan",
        ledger_index: "validated",
      });
      const loans  = loansRes.result.account_objects ?? [];
      const loanId = loans.length ? loans[loans.length - 1].index : null;

      let loan = null;
      if (loanId) {
        const le = await client.request({
          command:      "ledger_entry",
          index:        loanId,
          ledger_index: "validated",
        });
        loan = le.result.node;
      }

      const loanScale          = loan?.LoanScale ?? -6;
      const periodicPaymentRaw = loan ? parseFloat(loan.PeriodicPayment) : null;

      return NextResponse.json({
        ok:                 true,
        hash:               res.result.hash,
        loanId,
        periodicPayment:    periodicPaymentRaw ? roundUpByScale(periodicPaymentRaw, loanScale) : null,
        nextPaymentDueDate: loan?.NextPaymentDueDate,
        paymentsTotal:      PAYMENT_TOTAL,
      });
    } finally {
      await client.disconnect();
    }
  } catch (err) {
    console.error("[loans/create]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
