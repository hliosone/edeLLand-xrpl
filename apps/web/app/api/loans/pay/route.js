import { NextResponse } from "next/server";
import { Client, Wallet } from "xrpl";

// ── Constants ─────────────────────────────────────────────────────────────────

const RLUSD_CURRENCY   = "524C555344000000000000000000000000000000";
const RIPPLE_EPOCH     = 946684800;
const SECONDS_PER_YEAR = 31_536_000;

// Round UP to the loan's exact precision using LoanScale from the ledger.
// Actual payment = ceil(value × 10^(-LoanScale)) × 10^LoanScale
function roundUpByScale(value, loanScale) {
  const factor = Math.pow(10, -loanScale); // e.g. 10^11 for LoanScale=-11
  const result = Math.ceil(value * factor) / factor;
  const decimals = Math.max(0, -loanScale);
  return result.toFixed(decimals);
}

// ── POST /api/loans/pay ───────────────────────────────────────────────────────
// Body: { loanId: string, borrowerAddress?: string }
// Returns: { ok, hash, amountPaid, wasLate, wasFinal, paymentsRemaining } | { error }

export async function POST(request) {
  try {
    const { loanId, borrowerAddress } = await request.json();

    if (!loanId) {
      return NextResponse.json({ error: "loanId is required" }, { status: 400 });
    }

    const borrowerSeed = process.env.PLATFORM_BROKER_WALLET_SEED;
    const rlusdIssuer  = process.env.RLUSD_ISSUER_WALLET_ADDRESS;
    const endpoint     = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";

    if (!borrowerSeed || !rlusdIssuer) {
      return NextResponse.json({ error: "Backend not configured" }, { status: 500 });
    }

    const borrower = Wallet.fromSeed(borrowerSeed);

    if (borrowerAddress && borrowerAddress !== borrower.address) {
      return NextResponse.json({
        error: `Connected wallet (${borrowerAddress}) is not the registered borrower.`,
      }, { status: 400 });
    }

    const client = new Client(endpoint);
    await client.connect();

    try {
      // ── 1. Fetch current Loan state from ledger ────────────────────────────
      const le   = await client.request({
        command:      "ledger_entry",
        index:        loanId,
        ledger_index: "validated",
      });
      const loan = le.result.node;

      if (loan.LedgerEntryType !== "Loan") {
        return NextResponse.json({ error: "Object is not a Loan" }, { status: 400 });
      }
      if (loan.PaymentRemaining === 0) {
        return NextResponse.json({ error: "Loan is already fully paid" }, { status: 400 });
      }
      if (loan.Flags & 0x00010000) {
        return NextResponse.json({ error: "Loan is defaulted — contact broker" }, { status: 400 });
      }

      // ── 2. Compute payment amount and flags ────────────────────────────────
      const nowRipple  = Math.floor(Date.now() / 1000) - RIPPLE_EPOCH;
      const isLast     = loan.PaymentRemaining === 1;
      const isLate     = !isLast && loan.NextPaymentDueDate && nowRipple > loan.NextPaymentDueDate;
      const loanScale  = loan.LoanScale ?? -6; // precision exponent from ledger

      let paymentValue;
      let flags = 0;
      let lateInterestApplied = "0";

      if (isLast) {
        // Final payment: TotalValueOutstanding exactly (spec clears rounding dust)
        paymentValue = roundUpByScale(parseFloat(loan.TotalValueOutstanding), loanScale);
      } else if (isLate) {
        flags = 0x00040000; // tfLoanLatePayment — required when overdue

        const secondsOverdue  = nowRipple - loan.NextPaymentDueDate;
        const lateRate        = ((loan.LateInterestRate ?? 0) / 1_000_000) * secondsOverdue / SECONDS_PER_YEAR;
        const lateInterest    = parseFloat(loan.PrincipalOutstanding) * lateRate;
        const latePaymentFee  = parseFloat(loan.LatePaymentFee ?? "0");
        const serviceFee      = parseFloat(loan.LoanServiceFee ?? "0");
        const periodicPayment = parseFloat(loan.PeriodicPayment);

        lateInterestApplied = lateInterest.toFixed(Math.max(0, -loanScale));
        paymentValue = roundUpByScale(periodicPayment + serviceFee + latePaymentFee + lateInterest, loanScale);
      } else {
        // Regular on-time payment
        const periodicPayment = parseFloat(loan.PeriodicPayment);
        const serviceFee      = parseFloat(loan.LoanServiceFee ?? "0");
        paymentValue = roundUpByScale(periodicPayment + serviceFee, loanScale);
      }

      // ── 3. Build, sign and submit LoanPay ─────────────────────────────────
      const loanPay = {
        TransactionType: "LoanPay",
        Account:         borrower.address,
        LoanID:          loanId,
        Amount: {
          currency: RLUSD_CURRENCY,
          issuer:   rlusdIssuer,
          value:    paymentValue,
        },
        Flags: flags,
      };

      const res    = await client.submitAndWait(loanPay, { autofill: true, wallet: borrower });
      const result = res.result.meta?.TransactionResult;
      if (result !== "tesSUCCESS") {
        return NextResponse.json({ error: `LoanPay failed: ${result}` }, { status: 400 });
      }

      // ── 4. Fetch updated loan state (may be deleted if last payment) ───────
      let paymentsRemaining = isLast ? 0 : (loan.PaymentRemaining - 1);
      let nextDueDate       = null;
      try {
        const updated = (await client.request({
          command:      "ledger_entry",
          index:        loanId,
          ledger_index: "validated",
        })).result.node;
        paymentsRemaining = updated.PaymentRemaining;
        nextDueDate       = updated.NextPaymentDueDate;
      } catch { /* loan deleted after final payment */ }

      return NextResponse.json({
        ok:                true,
        hash:              res.result.hash,
        amountPaid:        paymentValue,
        wasLate:           isLate,
        wasFinal:          isLast,
        lateInterest:      lateInterestApplied,
        paymentsRemaining,
        nextDueDate,
      });
    } finally {
      await client.disconnect();
    }
  } catch (err) {
    console.error("[loans/pay]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
