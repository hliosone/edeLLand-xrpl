/**
 * Step 3 — Create the Loan via LoanSet (dual-sign).
 *
 * LoanSet requires two signatures:
 *   - Submitter (PLATFORM_ISSUER = LoanBroker.Owner) signs the outer transaction
 *   - Counterparty (BORROWER) provides a CounterpartySignature embedded in the tx
 *
 * Loan terms (devnet / quick test):
 *   - PrincipalRequested : 100 RLUSD
 *   - PaymentTotal       : 3 installments
 *   - PaymentInterval    : 60 s  (minimum; keeps demo fast on devnet)
 *   - GracePeriod        : 60 s  (must equal PaymentInterval when interval = 60)
 *   - InterestRate       : 10000 (= 10000 / 1_000_000 = 1% annually; tiny at 60s)
 *
 * Writes to .env.local:
 *   LOAN_ID
 *   LOAN_PERIODIC_PAYMENT
 *   LOAN_PRINCIPAL
 */

import { Client, Wallet, signLoanSetByCounterparty } from "xrpl";
import { writeEnvVars } from "../setup/env-writer.mjs";

const RLUSD_CURRENCY = "524C555344000000000000000000000000000000";

// ── Loan parameters ───────────────────────────────────────────────────────────
const PRINCIPAL        = "100";   // RLUSD
const PAYMENT_TOTAL    = 3;
const PAYMENT_INTERVAL = 60;      // seconds (minimum allowed)
const GRACE_PERIOD     = 60;      // seconds (must equal PaymentInterval when at min)
const INTEREST_RATE    = 50_000;  // 1/10th bps; 50000 / 1_000_000 = 5% annual

function roundUpRLUSD(value) {
  const SCALE = 1e6;
  return (Math.ceil(value * SCALE) / SCALE).toFixed(6);
}

async function fetchLoanId(client, borrowerAddress) {
  const res = await client.request({
    command:      "account_objects",
    account:      borrowerAddress,
    ledger_index: "validated",
    type:         "loan",
  });
  const loans = res.result.account_objects;
  if (!loans.length) return null;
  return loans[loans.length - 1].index;
}

export async function createLoan(ctx) {
  const DEVNET_WSS = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";
  const broker   = ctx.PLATFORM_BROKER_WALLET ?? Wallet.fromSeed(process.env.PLATFORM_BROKER_WALLET_SEED);
  const borrower = ctx.BORROWER_WALLET        ?? Wallet.fromSeed(process.env.BORROWER_WALLET_SEED);
  const rlusdIssuer  = process.env.RLUSD_ISSUER_WALLET_ADDRESS;
  const loanBrokerId = ctx.LOAN_BROKER_ID ?? process.env.LOAN_BROKER_ID;

  if (!broker || !borrower || !rlusdIssuer || !loanBrokerId) {
    throw new Error(
      "Missing wallet or IDs — run steps 1-2 first (or pnpm init:env for base setup). " +
      "Required: PLATFORM_BROKER_WALLET_SEED, BORROWER_WALLET_SEED, " +
      "RLUSD_ISSUER_WALLET_ADDRESS, LOAN_BROKER_ID."
    );
  }

  console.log(`\n[create-loan] Broker (LoanBroker.Owner) : ${broker.address}`);
  console.log(`[create-loan] Borrower                  : ${borrower.address}`);
  console.log(`[create-loan] Principal                 : ${PRINCIPAL} RLUSD`);
  console.log(`[create-loan] PaymentTotal / Interval   : ${PAYMENT_TOTAL} × ${PAYMENT_INTERVAL}s`);

  const client = new Client(DEVNET_WSS);
  await client.connect();

  // ── 1. Build the LoanSet tx (no signatures yet) ────────────────────────────
  const loanSetBase = {
    TransactionType:  "LoanSet",
    Account:          broker.address,
    LoanBrokerID:     loanBrokerId,
    Counterparty:     borrower.address,
    PrincipalRequested: PRINCIPAL,
    InterestRate:     INTEREST_RATE,
    PaymentTotal:     PAYMENT_TOTAL,
    PaymentInterval:  PAYMENT_INTERVAL,
    GracePeriod:      GRACE_PERIOD,
  };

  const prepared = await client.autofill(loanSetBase);

  // ── 2. Broker signs first (outer TxnSignature) ────────────────────────────
  console.log(`\n  → LoanSet — step 1: broker outer signature`);
  const brokerSigned = broker.sign(prepared);

  // ── 3. Borrower countersigns (CounterpartySignature) ──────────────────────
  console.log(`  → LoanSet — step 2: borrower CounterpartySignature`);
  const { tx_blob: finalBlob, hash } = signLoanSetByCounterparty(borrower, brokerSigned.tx_blob);
  console.log(`    Hash: ${hash}`);

  // ── 4. Submit the dual-signed transaction ─────────────────────────────────
  console.log(`  → LoanSet — submit`);
  const res = await client.submitAndWait(finalBlob);
  const result = res.result.meta.TransactionResult;
  const ok     = result === "tesSUCCESS";
  console.log(`    ${ok ? "✔" : "✖"} ${result} | ${res.result.hash}`);
  if (!ok) throw new Error(`LoanSet failed: ${result}`);

  // ── 5. Fetch the created Loan object ──────────────────────────────────────
  console.log(`\n  Fetching Loan object for borrower ${borrower.address}...`);
  const loanId = await fetchLoanId(client, borrower.address);
  if (!loanId) throw new Error("Loan not found after LoanSet");
  console.log(`    LoanID: ${loanId}`);

  const loanObj = (await client.request({
    command:      "ledger_entry",
    index:        loanId,
    ledger_index: "validated",
  })).result.node;

  const periodicPaymentRaw = parseFloat(loanObj.PeriodicPayment);
  const periodicPaymentStr = roundUpRLUSD(periodicPaymentRaw);

  console.log(`\n  Loan state:`);
  console.log(`    TotalValueOutstanding : ${loanObj.TotalValueOutstanding}`);
  console.log(`    PrincipalOutstanding  : ${loanObj.PrincipalOutstanding}`);
  console.log(`    PeriodicPayment (raw) : ${loanObj.PeriodicPayment}`);
  console.log(`    PeriodicPayment (↑)   : ${periodicPaymentStr} RLUSD`);
  console.log(`    PaymentRemaining      : ${loanObj.PaymentRemaining}`);
  console.log(`    NextPaymentDueDate    : ${new Date((loanObj.NextPaymentDueDate + 946684800) * 1000).toISOString()}`);

  // Verify borrower received RLUSD
  const lines = await client.request({
    command:      "account_lines",
    account:      borrower.address,
    ledger_index: "validated",
  });
  const rlusdLine = lines.result.lines.find((l) => l.account === rlusdIssuer);
  console.log(`\n  Borrower RLUSD balance: ${rlusdLine?.balance ?? "0"} RLUSD`);

  writeEnvVars({
    LOAN_ID:               loanId,
    LOAN_PERIODIC_PAYMENT: periodicPaymentStr,
    LOAN_PRINCIPAL:        PRINCIPAL,
  });

  await client.disconnect();

  ctx.LOAN_ID               = loanId;
  ctx.LOAN_PERIODIC_PAYMENT = periodicPaymentStr;
  ctx.PLATFORM_ISSUER       = broker;
  ctx.BORROWER_WALLET       = borrower;
  return {
    LOAN_ID:               loanId,
    LOAN_PERIODIC_PAYMENT: periodicPaymentStr,
    PLATFORM_ISSUER:       broker,
    BORROWER_WALLET:       borrower,
  };
}
