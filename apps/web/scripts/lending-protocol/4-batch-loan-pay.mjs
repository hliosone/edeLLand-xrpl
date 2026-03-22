/**
 * Step 4 — Batch Transaction demo.
 *
 * Submits ONE atomic Batch containing THREE inner transactions:
 *
 *   [INNER 1] LoanBrokerCoverDeposit — by PLATFORM_ISSUER (broker)
 *   [INNER 2] LoanPay — by BORROWER
 *   [INNER 3] Payment — by BORROWER → PLATFORM_ISSUER
 *
 * The Batch flag is tfAllOrNothing (65536): if any inner tx fails, NONE execute.
 */

import { Client, Wallet, signMultiBatch } from "xrpl";

const RLUSD_CURRENCY = "524C555344000000000000000000000000000000";

const TF_ALL_OR_NOTHING  = 65536;
const TF_INNER_BATCH_TXN = 0x40000000;

const COVER_TOP_UP     = "10";
const PLATFORM_PAYMENT = "50";

export async function batchLoanPay(ctx) {
  const DEVNET_WSS = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";
  const broker   = ctx.PLATFORM_ISSUER ?? Wallet.fromSeed(process.env.PLATFORM_ISSUER_WALLET_SEED);
  const borrower = ctx.BORROWER_WALLET ?? Wallet.fromSeed(process.env.BORROWER_WALLET_SEED);
  const rlusdIssuer     = process.env.RLUSD_ISSUER_WALLET_ADDRESS;
  const loanBrokerId    = ctx.LOAN_BROKER_ID    ?? process.env.LOAN_BROKER_ID;
  const loanId          = ctx.LOAN_ID           ?? process.env.LOAN_ID;
  const periodicPayment = ctx.LOAN_PERIODIC_PAYMENT ?? process.env.LOAN_PERIODIC_PAYMENT;

  if (!broker || !borrower || !rlusdIssuer || !loanBrokerId || !loanId || !periodicPayment) {
    throw new Error(
      "Missing wallet or IDs — run steps 1-3 first. " +
      "Required: PLATFORM_ISSUER_WALLET_SEED, BORROWER_WALLET_SEED, " +
      "RLUSD_ISSUER_WALLET_ADDRESS, LOAN_BROKER_ID, LOAN_ID, LOAN_PERIODIC_PAYMENT."
    );
  }

  console.log(`\n[batch-loan-pay] Broker (BatchSigner)   : ${broker.address}`);
  console.log(`[batch-loan-pay] Borrower (submitter)   : ${borrower.address}`);
  console.log(`[batch-loan-pay] LoanID                 : ${loanId}`);
  console.log(`[batch-loan-pay] PeriodicPayment        : ${periodicPayment} RLUSD`);

  const client = new Client(DEVNET_WSS);
  await client.connect();

  await printRLUSDBalance(client, "Borrower (before)", borrower.address, rlusdIssuer);
  await printRLUSDBalance(client, "Platform (before)", broker.address,   rlusdIssuer);

  const innerCoverDeposit = {
    TransactionType: "LoanBrokerCoverDeposit",
    Account:         broker.address,
    LoanBrokerID:    loanBrokerId,
    Amount: {
      currency: RLUSD_CURRENCY,
      issuer:   rlusdIssuer,
      value:    COVER_TOP_UP,
    },
    Flags: TF_INNER_BATCH_TXN,
  };

  const innerLoanPay = {
    TransactionType: "LoanPay",
    Account:         borrower.address,
    LoanID:          loanId,
    Amount: {
      currency: RLUSD_CURRENCY,
      issuer:   rlusdIssuer,
      value:    periodicPayment,
    },
    Flags: TF_INNER_BATCH_TXN,
  };

  const innerPlatformPayment = {
    TransactionType: "Payment",
    Account:         borrower.address,
    Destination:     broker.address,
    Amount: {
      currency: RLUSD_CURRENCY,
      issuer:   rlusdIssuer,
      value:    PLATFORM_PAYMENT,
    },
    Flags: TF_INNER_BATCH_TXN,
  };

  const batchTx = {
    TransactionType: "Batch",
    Account:         borrower.address,
    Flags:           TF_ALL_OR_NOTHING,
    RawTransactions: [
      { RawTransaction: innerCoverDeposit      },
      { RawTransaction: innerLoanPay           },
      { RawTransaction: innerPlatformPayment   },
    ],
  };

  console.log(`\n  Autofilling Batch tx...`);
  const prepared = await client.autofill(batchTx);
  console.log(`    Outer Batch sequence : ${prepared.Sequence}`);
  console.log(`    Outer Batch fee      : ${prepared.Fee} drops`);
  for (const [i, raw] of prepared.RawTransactions.entries()) {
    const inner = raw.RawTransaction;
    console.log(`    Inner[${i}] ${inner.TransactionType.padEnd(24)} seq=${inner.Sequence} fee=${inner.Fee}`);
  }

  console.log(`\n  Broker signing Batch (signMultiBatch)...`);
  signMultiBatch(broker, prepared);
  console.log(`    BatchSigners: [${prepared.BatchSigners.map((s) => s.BatchSigner.Account).join(", ")}]`);

  console.log(`\n  Borrower signing outer Batch...`);
  const signed = borrower.sign(prepared);
  console.log(`    Hash: ${signed.hash}`);

  console.log(`\n  → Batch submit`);
  const res    = await client.submitAndWait(signed.tx_blob);
  const result = res.result.meta.TransactionResult;
  const ok     = result === "tesSUCCESS";
  console.log(`    ${ok ? "✔" : "✖"} ${result} | ${res.result.hash}`);
  if (!ok) throw new Error(`Batch failed: ${result}`);

  const innerResults = res.result.meta.InnerTransactionResults ?? [];
  for (const [i, inner] of innerResults.entries()) {
    const code = inner.TransactionResult ?? inner.metadata?.TransactionResult ?? "?";
    console.log(`    Inner[${i}]: ${code}`);
  }

  await printRLUSDBalance(client, "Borrower (after)", borrower.address, rlusdIssuer);
  await printRLUSDBalance(client, "Platform (after)", broker.address,   rlusdIssuer);

  try {
    const loan = (await client.request({
      command:      "ledger_entry",
      index:        loanId,
      ledger_index: "validated",
    })).result.node;
    console.log(`\n  Loan state after payment:`);
    console.log(`    TotalValueOutstanding : ${loan.TotalValueOutstanding}`);
    console.log(`    PaymentRemaining      : ${loan.PaymentRemaining}`);
  } catch { /* loan may be deleted if PaymentRemaining reached 0 */ }

  await client.disconnect();
}

async function printRLUSDBalance(client, label, address, issuerAddress) {
  try {
    const lines = await client.request({
      command: "account_lines",
      account: address,
    });
    const line = lines.result.lines.find((l) => l.account === issuerAddress);
    console.log(`  ${label.padEnd(22)}: ${line?.balance ?? "0"} RLUSD`);
  } catch {
    console.log(`  ${label.padEnd(22)}: (error reading balance)`);
  }
}
