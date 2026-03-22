/**
 * Step 1 — Create & fund the borrower (test user) wallet.
 *
 * Actions:
 *   - Fund a fresh wallet from the devnet faucet
 *   - Set a RLUSD trust line toward RLUSD_ISSUER
 *     (required BEFORE receiving any loan disbursement in RLUSD)
 *
 * Writes to .env.local:
 *   BORROWER_WALLET_ADDRESS
 *   BORROWER_WALLET_SEED
 */

import { Client, Wallet } from "xrpl";
import path from "path";
import { fileURLToPath } from "url";
import { writeEnvVars } from "../setup/env-writer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEVNET_FAUCET  = "faucet.devnet.rippletest.net";
const RLUSD_CURRENCY = "524C555344000000000000000000000000000000";
const TRUST_LIMIT    = "1000000000";

async function submit(client, tx, wallet, label) {
  console.log(`\n  → ${label}`);
  const res    = await client.submitAndWait(tx, { autofill: true, wallet });
  const result = res.result.meta.TransactionResult;
  const ok     = result === "tesSUCCESS";
  console.log(`    ${ok ? "✔" : "✖"} ${result} | ${res.result.hash}`);
  if (!ok) throw new Error(`Transaction failed: ${result}`);
  return res;
}

export async function setupBorrower(ctx) {
  const DEVNET_WSS  = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";
  const isLocal     = DEVNET_WSS.includes("localhost") || DEVNET_WSS.includes("127.0.0.1");
  const rlusdIssuer = process.env.RLUSD_ISSUER_WALLET_ADDRESS;
  if (!rlusdIssuer) {
    throw new Error("RLUSD_ISSUER_WALLET_ADDRESS not set — run pnpm init:env first");
  }

  const client = new Client(DEVNET_WSS);
  await client.connect();

  // ── 1. Fund a fresh borrower wallet ─────────────────────────────────────────
  console.log("\n  Funding borrower wallet from devnet faucet...");
  const faucetPort = process.env.FAUCET_PORT ?? "7007"
  const fundOpts = isLocal
    ? { faucetHost: `localhost:${faucetPort}`, faucetPath: "/accounts", faucetProtocol: "http" }
    : { faucetHost: DEVNET_FAUCET };
  const { wallet: borrower } = await client.fundWallet(null, fundOpts);
  const balance = await client.getXrpBalance(borrower.address);

  console.log(`    Address : ${borrower.address}`);
  console.log(`    Seed    : ${borrower.seed}`);
  console.log(`    Balance : ${balance} XRP`);

  writeEnvVars({
    BORROWER_WALLET_ADDRESS: borrower.address,
    BORROWER_WALLET_SEED:    borrower.seed,
  });

  // ── 2. Borrower sets RLUSD trust line ────────────────────────────────────────
  // Must be done BEFORE receiving the loan disbursement in RLUSD.
  await submit(client, {
    TransactionType: "TrustSet",
    Account:         borrower.address,
    LimitAmount: {
      currency: RLUSD_CURRENCY,
      issuer:   rlusdIssuer,
      value:    TRUST_LIMIT,
    },
  }, borrower, `TrustSet — borrower trusts RLUSD from ${rlusdIssuer}`);

  console.log(`\n  Borrower RLUSD trust line created.`);

  await client.disconnect();

  ctx.BORROWER_WALLET = borrower;
  return { BORROWER_WALLET: borrower };
}
