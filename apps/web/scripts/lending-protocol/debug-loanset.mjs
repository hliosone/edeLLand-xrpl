/**
 * debug-loanset.mjs
 *
 * End-to-end LoanSet debug script — tests both signing orders against devnet.
 *
 * Tests two flows and reports which works:
 *   Flow A (current API): Account = borrower  → broker adds CounterpartySignature
 *   Flow B (scripts):     Account = broker    → borrower adds CounterpartySignature
 *
 * Wallets used (from .env.local):
 *   PLATFORM_ISSUER_WALLET_SEED  → LoanBroker.Owner (submits LoanBrokerSet)
 *   PLATFORM_BROKER_WALLET_SEED  → used as test borrower (separate wallet)
 *   LOAN_BROKER_ID               → existing LoanBroker object on devnet
 *
 * Usage:
 *   cd apps/web
 *   pnpm exec dotenv -e .env.local -- node scripts/lending-protocol/debug-loanset.mjs
 *
 *   Or if dotenv-cli is not available:
 *   node --env-file=.env.local scripts/lending-protocol/debug-loanset.mjs
 */

import { Client, Wallet, signLoanSetByCounterparty, decode, encode } from "xrpl";

// ── Config ────────────────────────────────────────────────────────────────────

const DEVNET_WSS       = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";
const RLUSD_CURRENCY   = "524C555344000000000000000000000000000000";
const RLUSD_ISSUER     = process.env.RLUSD_ISSUER_WALLET_ADDRESS;
const LOAN_BROKER_ID   = process.env.LOAN_BROKER_ID;

// Loan parameters — short intervals for quick devnet testing
const PRINCIPAL        = "50";    // RLUSD
const INTEREST_RATE    = 50_000;  // 5% annual (1/10th bps)
const PAYMENT_TOTAL    = 3;
const PAYMENT_INTERVAL = 60;      // 60s — minimum allowed; demo fast
const GRACE_PERIOD     = 60;      // must equal PAYMENT_INTERVAL at minimum

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg)    { console.log(msg); }
function ok(msg)     { console.log(`  ✔ ${msg}`); }
function fail(msg)   { console.log(`  ✖ ${msg}`); }
function section(n)  { console.log(`\n${"─".repeat(60)}\n  ${n}\n${"─".repeat(60)}`); }

async function fetchLoanBroker(client) {
  const res = await client.request({
    command:      "ledger_entry",
    index:        LOAN_BROKER_ID,
    ledger_index: "validated",
  });
  return res.result.node;
}

async function fetchLoans(client, address) {
  const res = await client.request({
    command:      "account_objects",
    account:      address,
    type:         "loan",
    ledger_index: "validated",
  });
  return res.result.account_objects ?? [];
}

async function accountInfo(client, address) {
  try {
    const res = await client.request({ command: "account_info", account: address, ledger_index: "validated" });
    return res.result.account_data;
  } catch { return null; }
}

async function rlusdBalance(client, address) {
  try {
    const res = await client.request({ command: "account_lines", account: address, ledger_index: "validated" });
    const line = (res.result.lines ?? []).find(l => l.account === RLUSD_ISSUER);
    return line?.balance ?? "0";
  } catch { return "0"; }
}

async function buildLoanSet(client, accountAddress, counterpartyAddress) {
  const base = {
    TransactionType:    "LoanSet",
    Account:            accountAddress,
    LoanBrokerID:       LOAN_BROKER_ID,
    Counterparty:       counterpartyAddress,
    PrincipalRequested: PRINCIPAL,
    InterestRate:       INTEREST_RATE,
    PaymentTotal:       PAYMENT_TOTAL,
    PaymentInterval:    PAYMENT_INTERVAL,
    GracePeriod:        GRACE_PERIOD,
  };
  return client.autofill(base);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // ── Load wallets ────────────────────────────────────────────────────────────
  const brokerSeed   = process.env.PLATFORM_ISSUER_WALLET_SEED;
  const borrowerSeed = process.env.PLATFORM_BROKER_WALLET_SEED;

  if (!brokerSeed || !borrowerSeed) {
    fail("Missing PLATFORM_ISSUER_WALLET_SEED or PLATFORM_BROKER_WALLET_SEED in env");
    process.exit(1);
  }
  if (!LOAN_BROKER_ID) {
    fail("Missing LOAN_BROKER_ID in env — run 2-setup-loan-broker.mjs first");
    process.exit(1);
  }
  if (!RLUSD_ISSUER) {
    fail("Missing RLUSD_ISSUER_WALLET_ADDRESS in env");
    process.exit(1);
  }

  const broker   = Wallet.fromSeed(brokerSeed);
  const borrower = Wallet.fromSeed(borrowerSeed);

  section("0. Setup");
  log(`  Broker   (LoanBroker.Owner) : ${broker.address}`);
  log(`  Borrower (test wallet)      : ${borrower.address}`);
  log(`  LoanBrokerID                : ${LOAN_BROKER_ID}`);
  log(`  Network                     : ${DEVNET_WSS}`);
  log(`  Principal                   : ${PRINCIPAL} RLUSD`);
  log(`  Interval / Grace            : ${PAYMENT_INTERVAL}s / ${GRACE_PERIOD}s`);

  const client = new Client(DEVNET_WSS);
  await client.connect();
  log(`\n  Connected to devnet`);

  try {
    // ── 1. Check LoanBroker state ──────────────────────────────────────────────
    section("1. LoanBroker state");
    try {
      const lb = await fetchLoanBroker(client);
      log(`  LedgerEntryType : ${lb.LedgerEntryType}`);
      log(`  Owner           : ${lb.Owner}`);
      log(`  Account (pseudo): ${lb.Account}`);
      log(`  CoverAvailable  : ${lb.CoverAvailable ?? "(none)"}`);
      log(`  DebtTotal       : ${lb.DebtTotal ?? 0}`);
      log(`  OwnerCount      : ${lb.OwnerCount}`);
      log(`  VaultID         : ${lb.VaultID}`);

      if (lb.Owner !== broker.address) {
        fail(`LoanBroker.Owner is ${lb.Owner} but broker wallet is ${broker.address}`);
        fail("The PLATFORM_ISSUER_WALLET_SEED may be wrong. Check your env.");
      } else {
        ok(`LoanBroker.Owner matches broker wallet`);
      }
    } catch (e) {
      fail(`Could not fetch LoanBroker: ${e.message}`);
      fail("Is LOAN_BROKER_ID correct? Has setup-loan-broker been run?");
    }

    // ── 2. Check borrower accounts ─────────────────────────────────────────────
    section("2. Account balances");
    const brokerInfo   = await accountInfo(client, broker.address);
    const borrowerInfo = await accountInfo(client, borrower.address);

    log(`  Broker   XRP balance : ${brokerInfo ? (parseInt(brokerInfo.Balance) / 1e6).toFixed(6) : "NOT FOUND"} XRP`);
    log(`  Borrower XRP balance : ${borrowerInfo ? (parseInt(borrowerInfo.Balance) / 1e6).toFixed(6) : "NOT FOUND"} XRP`);

    const borrowerRLUSD = await rlusdBalance(client, borrower.address);
    const brokerRLUSD   = await rlusdBalance(client, broker.address);
    log(`  Broker   RLUSD : ${brokerRLUSD}`);
    log(`  Borrower RLUSD : ${borrowerRLUSD}`);

    if (!borrowerInfo) {
      fail("Borrower account not found on devnet — fund it first via admin faucet");
    }

    // ── 3. Existing loans for borrower ────────────────────────────────────────
    section("3. Existing loans (borrower)");
    const existingLoans = await fetchLoans(client, borrower.address);
    if (existingLoans.length === 0) {
      log("  (no loans)");
    } else {
      existingLoans.forEach((l, i) => {
        log(`  [${i}] ${l.index}`);
        log(`       Outstanding : ${l.TotalValueOutstanding}`);
        log(`       Remaining   : ${l.PaymentRemaining} payments`);
      });
    }

    // ── 4. Flow A: Account = borrower, CounterpartySignature = broker ─────────
    section("4. Flow A — Account=borrower, CounterpartySignature=broker");
    log("  (This is what the /api/loans/prepare+create routes use with Xumm)");
    let flowAOk = false;
    let flowALoanId = null;
    try {
      log("\n  Step 1: autofill LoanSet (Account = borrower)");
      const prepared = await buildLoanSet(client, borrower.address, broker.address);
      log(`    Fee            : ${prepared.Fee} drops`);
      log(`    Sequence       : ${prepared.Sequence}`);
      log(`    LastLedgerSeq  : ${prepared.LastLedgerSequence}`);

      log("\n  Step 2: borrower signs (outer TxnSignature)");
      const borrowerSigned = borrower.sign(prepared);
      log(`    Blob length    : ${borrowerSigned.tx_blob.length} chars`);
      log(`    Hash (pre-cp)  : ${borrowerSigned.hash}`);

      // Verify borrower signature is present
      const decoded1 = decode(borrowerSigned.tx_blob);
      log(`    TxnSignature   : ${decoded1.TxnSignature ? "present" : "MISSING"}`);
      log(`    SigningPubKey  : ${decoded1.SigningPubKey ? "present" : "MISSING"}`);

      log("\n  Step 3: broker adds CounterpartySignature");
      const { tx_blob: finalBlob, hash } = signLoanSetByCounterparty(broker, borrowerSigned.tx_blob);
      log(`    Final hash     : ${hash}`);

      // Verify final blob structure
      const decoded2 = decode(finalBlob);
      log(`    TxnSignature          : ${decoded2.TxnSignature ? "present" : "MISSING"}`);
      log(`    CounterpartySignature : ${decoded2.CounterpartySignature ? "present" : "MISSING"}`);
      if (decoded2.CounterpartySignature) {
        log(`    CP.SigningPubKey      : ${decoded2.CounterpartySignature.SigningPubKey}`);
        log(`    CP.TxnSignature      : ${decoded2.CounterpartySignature.TxnSignature?.slice(0, 32)}...`);
      }

      log("\n  Step 4: submit dual-signed transaction");
      const res = await client.submitAndWait(finalBlob);
      const result = res.result.meta?.TransactionResult;
      if (result === "tesSUCCESS") {
        ok(`LoanSet submitted: ${res.result.hash}`);
        flowAOk = true;
      } else {
        fail(`LoanSet failed: ${result}`);
        if (res.result.meta?.TransactionResult) {
          log(`    Full result: ${JSON.stringify(res.result.meta, null, 4)}`);
        }
      }

      if (flowAOk) {
        const loans = await fetchLoans(client, borrower.address);
        const newLoan = loans.find(l => !existingLoans.map(e => e.index).includes(l.index));
        if (newLoan) {
          flowALoanId = newLoan.index;
          ok(`Loan created: ${flowALoanId}`);
          log(`    TotalValueOutstanding : ${newLoan.TotalValueOutstanding}`);
          log(`    PeriodicPayment       : ${newLoan.PeriodicPayment}`);
          log(`    PaymentRemaining      : ${newLoan.PaymentRemaining}`);
        }
      }
    } catch (e) {
      fail(`Flow A error: ${e.message}`);
      log(`    Stack: ${e.stack?.split("\n")[1] ?? ""}`);
    }

    // ── 5. Flow B: Account = broker, CounterpartySignature = borrower ─────────
    section("5. Flow B — Account=broker, CounterpartySignature=borrower");
    log("  (This is what the working 3-create-loan.mjs script uses)");
    let flowBOk = false;
    let flowBLoanId = null;
    try {
      log("\n  Step 1: autofill LoanSet (Account = broker)");
      const prepared = await buildLoanSet(client, broker.address, borrower.address);
      log(`    Fee            : ${prepared.Fee} drops`);
      log(`    Sequence       : ${prepared.Sequence}`);

      log("\n  Step 2: broker signs (outer TxnSignature)");
      const brokerSigned = broker.sign(prepared);
      log(`    Blob length    : ${brokerSigned.tx_blob.length} chars`);
      log(`    Hash (pre-cp)  : ${brokerSigned.hash}`);

      log("\n  Step 3: borrower adds CounterpartySignature");
      const { tx_blob: finalBlob, hash } = signLoanSetByCounterparty(borrower, brokerSigned.tx_blob);
      log(`    Final hash     : ${hash}`);

      const decoded2 = decode(finalBlob);
      log(`    TxnSignature          : ${decoded2.TxnSignature ? "present" : "MISSING"}`);
      log(`    CounterpartySignature : ${decoded2.CounterpartySignature ? "present" : "MISSING"}`);

      log("\n  Step 4: submit dual-signed transaction");
      const res = await client.submitAndWait(finalBlob);
      const result = res.result.meta?.TransactionResult;
      if (result === "tesSUCCESS") {
        ok(`LoanSet submitted: ${res.result.hash}`);
        flowBOk = true;
      } else {
        fail(`LoanSet failed: ${result}`);
        log(`    TransactionResult: ${result}`);
      }

      if (flowBOk) {
        const allLoans = await fetchLoans(client, borrower.address);
        const allIds = existingLoans.map(e => e.index);
        if (flowALoanId) allIds.push(flowALoanId);
        const newLoan = allLoans.find(l => !allIds.includes(l.index));
        if (newLoan) {
          flowBLoanId = newLoan.index;
          ok(`Loan created: ${flowBLoanId}`);
          log(`    TotalValueOutstanding : ${newLoan.TotalValueOutstanding}`);
          log(`    PeriodicPayment       : ${newLoan.PeriodicPayment}`);
          log(`    PaymentRemaining      : ${newLoan.PaymentRemaining}`);
        }
      }
    } catch (e) {
      fail(`Flow B error: ${e.message}`);
      log(`    Stack: ${e.stack?.split("\n")[1] ?? ""}`);
    }

    // ── 6. Summary ────────────────────────────────────────────────────────────
    section("6. Summary");
    log(`  Flow A (Account=borrower, Xumm flow) : ${flowAOk ? "✔ WORKS" : "✖ FAILS"}`);
    log(`  Flow B (Account=broker,   script flow): ${flowBOk ? "✔ WORKS" : "✖ FAILS"}`);

    if (flowAOk) {
      ok("Flow A works — the API logic is correct.");
      ok("Root cause: Xumm does NOT support LoanSet (unknown tx type → local checks fail).");
      log("\n  Fix options:");
      log("  1. Use Account=borrower flow but bypass Xumm using a local wallet (seed in session)");
      log("  2. Use Account=broker flow, get borrower CounterpartySignature via xrpl.js in browser");
      log("  3. Full server-side signing for devnet demo (no wallet signing required from user)");
    }
    if (flowBOk) {
      ok("Flow B works — the existing scripts are correct.");
      if (!flowAOk) {
        ok("Fix: Flip API to Account=broker. Borrow CounterpartySignature must be computed differently.");
      }
    }
    if (!flowAOk && !flowBOk) {
      fail("Both flows fail. Check:");
      fail("  - LoanBroker.Owner matches broker wallet");
      fail("  - Vault has enough AssetsAvailable");
      fail("  - Borrower account exists and has RLUSD trust line");
    }

  } finally {
    await client.disconnect();
    log("\n  Disconnected.\n");
  }
}

main().catch((err) => {
  console.error("\nFatal:", err.message);
  process.exit(1);
});
