/**
 * debug-loan-pay.mjs — Inspect a Loan object and simulate/submit LoanPay
 *
 * Usage:
 *   node scripts/debug-loan-pay.mjs                  # inspect only, use LOAN_BROKER_ID to find loans
 *   node scripts/debug-loan-pay.mjs --submit          # also submit the payment with PLATFORM_BROKER_WALLET_SEED
 *   node scripts/debug-loan-pay.mjs --loan <LOAN_ID>  # target a specific loan ID
 *
 * Reads from .env.local automatically (via dotenv if installed, else set env vars manually).
 */

import pkg from "xrpl";
const { Client, Wallet } = pkg;

// ── Load .env.local ────────────────────────────────────────────────────────────
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
try {
  const env = readFileSync(resolve(__dir, "../.env.local"), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=["']?(.+?)["']?\s*$/);
    if (m) process.env[m[1]] ??= m[2];
  }
} catch { /* no .env.local, rely on process.env */ }

// ── Config ─────────────────────────────────────────────────────────────────────
const ENDPOINT        = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";
const BROKER_SEED     = process.env.PLATFORM_BROKER_WALLET_SEED;
const RLUSD_ISSUER    = process.env.RLUSD_ISSUER_WALLET_ADDRESS;
const LOAN_BROKER_ID  = process.env.LOAN_BROKER_ID;
const RLUSD_CURRENCY  = "524C555344000000000000000000000000000000";
const RIPPLE_EPOCH    = 946684800;
const SECONDS_PER_YEAR = 31_536_000;

const args          = process.argv.slice(2);
const SUBMIT        = args.includes("--submit");
const LOAN_ID_ARG   = args.includes("--loan") ? args[args.indexOf("--loan") + 1] : null;

// ── Helpers ────────────────────────────────────────────────────────────────────
function nowRipple() { return Math.floor(Date.now() / 1000) - RIPPLE_EPOCH; }

function roundUpByScale(value, loanScale) {
  const factor   = Math.pow(10, -loanScale);
  const result   = Math.ceil(value * factor) / factor;
  const decimals = Math.max(0, -loanScale);
  return result.toFixed(decimals);
}

function computePayment(loan) {
  const isLast      = loan.PaymentRemaining === 1;
  const isDefaulted = !!(loan.Flags & 0x00010000);
  const isClosed    = loan.PaymentRemaining === 0;
  const loanScale   = loan.LoanScale ?? -6;
  const now         = nowRipple();
  const due         = loan.NextPaymentDueDate;
  const grace       = loan.GracePeriod ?? 0;
  const isLate      = !isLast && due && now > due && now <= due + grace;
  const graceExpired = !isLast && due && now > due + grace;

  if (isDefaulted || isClosed) return null;

  const periodicPayment = parseFloat(loan.PeriodicPayment);
  const serviceFee      = parseFloat(loan.LoanServiceFee ?? "0") || 0;

  if (isLast) {
    const total = parseFloat(loan.TotalValueOutstanding);
    return { case: "FINAL", value: roundUpByScale(total, loanScale), flags: 0 };
  }

  if (graceExpired) {
    return { case: "GRACE_EXPIRED — broker must LoanManage(default)", value: null, flags: null };
  }

  if (isLate) {
    const secondsOverdue  = now - due;
    const lateRate        = ((loan.LateInterestRate ?? 0) / 1_000_000) * secondsOverdue / SECONDS_PER_YEAR;
    const lateInterest    = (parseFloat(loan.PrincipalOutstanding) || 0) * lateRate;
    const latePaymentFee  = parseFloat(loan.LatePaymentFee ?? "0") || 0;
    const total           = periodicPayment + serviceFee + latePaymentFee + lateInterest;
    return {
      case: "LATE",
      value: roundUpByScale(total, loanScale),
      flags: 0x00040000,
      breakdown: { periodicPayment, serviceFee, latePaymentFee, lateInterest, total },
    };
  }

  return {
    case: "REGULAR",
    value: roundUpByScale(periodicPayment + serviceFee, loanScale),
    flags: 0,
    breakdown: { periodicPayment, serviceFee, total: periodicPayment + serviceFee },
  };
}

// ── Main ───────────────────────────────────────────────────────────────────────
const client = new Client(ENDPOINT);
await client.connect();
console.log(`\n✅ Connected to ${ENDPOINT}\n`);

try {
  // 1. Find loan(s)
  let loanIds = [];
  if (LOAN_ID_ARG) {
    loanIds = [LOAN_ID_ARG];
  } else if (LOAN_BROKER_ID) {
    // Fetch via loan broker pseudo-account objects
    const brokerLE = await client.request({ command: "ledger_entry", index: LOAN_BROKER_ID, ledger_index: "validated" });
    const pseudoAccount = brokerLE.result.node?.Account;
    if (pseudoAccount) {
      const objs = await client.request({ command: "account_objects", account: pseudoAccount, type: "loan", ledger_index: "validated" });
      loanIds = (objs.result.account_objects ?? []).map(l => l.index);
      console.log(`Found ${loanIds.length} loan(s) under LoanBroker pseudo-account ${pseudoAccount}`);
    }
  }

  if (loanIds.length === 0) {
    console.log("No loans found. Pass --loan <LOAN_ID> or set LOAN_BROKER_ID.");
    process.exit(0);
  }

  // 2. Inspect each loan
  for (const loanId of loanIds) {
    console.log("─".repeat(72));
    let loan;
    try {
      const le = await client.request({ command: "ledger_entry", index: loanId, ledger_index: "validated" });
      loan = le.result.node;
    } catch (e) {
      console.log(`Loan ${loanId} not found on ledger (${e.message})`);
      continue;
    }

    console.log(`\n📋 Loan: ${loanId}`);
    console.log(`   Borrower          : ${loan.Borrower}`);
    console.log(`   PaymentRemaining  : ${loan.PaymentRemaining}`);
    console.log(`   NextPaymentDueDate: ${loan.NextPaymentDueDate} (now=${nowRipple()}, diff=${nowRipple() - (loan.NextPaymentDueDate ?? 0)}s)`);
    console.log(`   GracePeriod       : ${loan.GracePeriod}s`);
    console.log(`   LoanScale         : ${loan.LoanScale}`);
    console.log(`   PeriodicPayment   : ${loan.PeriodicPayment}`);
    console.log(`   LoanServiceFee    : ${loan.LoanServiceFee}`);
    console.log(`   LatePaymentFee    : ${loan.LatePaymentFee}`);
    console.log(`   LateInterestRate  : ${loan.LateInterestRate}`);
    console.log(`   PrincipalOutstanding    : ${loan.PrincipalOutstanding}`);
    console.log(`   TotalValueOutstanding   : ${loan.TotalValueOutstanding}`);
    console.log(`   InterestRate      : ${loan.InterestRate}`);
    console.log(`   Flags             : 0x${(loan.Flags ?? 0).toString(16)}`);

    const payment = computePayment(loan);
    console.log(`\n💰 Computed payment:`);
    console.log(JSON.stringify(payment, null, 2));

    if (!payment?.value) { console.log("⚠️  No payable amount (loan closed/defaulted/grace expired)."); continue; }

    const tx = {
      TransactionType: "LoanPay",
      Account:         loan.Borrower,
      LoanID:          loanId,
      Amount: { currency: RLUSD_CURRENCY, issuer: RLUSD_ISSUER, value: payment.value },
      Flags:           payment.flags,
    };
    console.log(`\n📤 Transaction that would be sent:`);
    console.log(JSON.stringify(tx, null, 2));

    if (SUBMIT && BROKER_SEED) {
      const wallet = Wallet.fromSeed(BROKER_SEED);
      console.log(`\n🚀 Submitting with wallet ${wallet.address}…`);
      const res    = await client.submitAndWait(tx, { autofill: true, wallet });
      const result = res.result.meta?.TransactionResult;
      console.log(`   Result: ${result}`);
      console.log(`   Hash  : ${res.result.hash}`);
    } else if (SUBMIT) {
      console.log("⚠️  --submit passed but PLATFORM_BROKER_WALLET_SEED not set.");
    }
  }
} finally {
  await client.disconnect();
  console.log("\nDone.");
}
