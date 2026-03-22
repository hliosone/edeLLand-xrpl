/**
 * Lending Protocol Flow — end-to-end demo script.
 *
 * Prerequisites: run `pnpm init:env` first (creates accounts, RLUSD, vault, credentials).
 *
 * Steps:
 *   1. Create & fund borrower wallet + set RLUSD trust line
 *   2. Create LoanBroker (by vault owner = LOAN_BROKER_WALLET) + deposit first-loss capital
 *   3. Create Loan (LoanSet dual-sign: LOAN_BROKER_WALLET submits, borrower countersigns)
 *   4. Batch TX: atomic {CoverDeposit by broker} + {LoanPay by borrower} + {Payment to platform}
 *
 * Run with:
 *   node scripts/lending-protocol/index.mjs
 *   (from apps/web)
 */

import path from "path";
import fs   from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Inline .env.local loader — no external dep needed
(function loadEnvLocal() {
  const envPath = path.resolve(__dirname, "../../.env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val   = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
})();

import { setupBorrower }    from "./1-setup-borrower.mjs";
import { setupLoanBroker }  from "./2-setup-loan-broker.mjs";
import { createLoan }       from "./3-create-loan.mjs";
import { batchLoanPay }     from "./4-batch-loan-pay.mjs";
import { Wallet }           from "xrpl";

async function loadBorrowerFromEnv(ctx) {
  const seed = process.env.BORROWER_WALLET_SEED;
  if (!seed) throw new Error("BORROWER_WALLET_SEED not set — lance setup-borrower-mnemonic.mjs d'abord.");
  const borrower = Wallet.fromSeed(seed);
  console.log(`  → Borrower depuis .env.local : ${borrower.address}`);
  ctx.BORROWER_WALLET = borrower;
  return { BORROWER_WALLET: borrower };
}

const skipBorrower = process.env.SKIP_BORROWER_SETUP === "1";

const steps = [
  {
    name: skipBorrower ? "Load borrower wallet from .env.local (SKIP_BORROWER_SETUP)" : "Setup borrower wallet + RLUSD trust line",
    fn:   skipBorrower ? loadBorrowerFromEnv : setupBorrower,
  },
  { name: "Setup LoanBroker + first-loss capital deposit",     fn: setupLoanBroker },
  { name: "Create Loan (LoanSet — dual-sign)",                 fn: createLoan      },
  { name: "Batch TX: CoverDeposit | LoanPay | Payment",        fn: batchLoanPay    },
];

async function main() {
  console.log("=== Lending Protocol Demo ===");
  console.log(`Running ${steps.length} step(s)...\n`);

  const ctx = {};

  for (const [i, step] of steps.entries()) {
    console.log(`[${i + 1}/${steps.length}] ${step.name}`);
    try {
      const result = await step.fn(ctx);
      Object.assign(ctx, result ?? {});
      console.log(`  → done\n`);
    } catch (err) {
      console.error(`  ✖ Step failed: ${err.message}`);
      if (process.env.DEBUG) console.error(err);
      process.exit(1);
    }
  }

  console.log("=== Lending Protocol Demo complete ===");
}

main();
