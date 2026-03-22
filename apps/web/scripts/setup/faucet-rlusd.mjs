/**
 * faucet-rlusd.mjs
 *
 * Generates a fresh devnet wallet, sets a RLUSD trust line,
 * and drips RLUSD from the PLATFORM_ISSUER_WALLET.
 *
 * Prerequisites: run `pnpm init:env` at least once so that
 *   PLATFORM_ISSUER_WALLET_ADDRESS, PLATFORM_ISSUER_WALLET_SEED, and
 *   NEXT_PUBLIC_RLUSD_ISSUER are present in apps/web/.env.local.
 *
 * Usage:
 *   node apps/web/scripts/setup/faucet-rlusd.mjs [amount]
 *   # amount defaults to 1000 RLUSD
 */

import { Client, Wallet } from "xrpl";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ── Config ────────────────────────────────────────────────────────────────────

const DEVNET_WSS   = "wss://s.devnet.rippletest.net:51233";
const DEVNET_FAUCET = "faucet.devnet.rippletest.net";
const CURRENCY     = "524C555344000000000000000000000000000000"; // "RLUSD"
const TRUST_LIMIT  = "1000000000";
const DROP_AMOUNT  = process.argv[2] ?? "1000";

// ── Env loader ────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH  = path.resolve(__dirname, "../../.env.local");

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  return Object.fromEntries(
    fs.readFileSync(ENV_PATH, "utf8")
      .split("\n")
      .filter(l => l.includes("=") && !l.startsWith("#"))
      .map(l => {
        const [k, ...rest] = l.split("=");
        return [k.trim(), rest.join("=").trim().replace(/^"|"$/g, "")];
      })
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function submit(client, tx, wallet, label) {
  process.stdout.write(`  → ${label} ... `);
  const res    = await client.submitAndWait(tx, { autofill: true, wallet });
  const result = res.result.meta.TransactionResult;
  const ok     = result === "tesSUCCESS";
  console.log(`${ok ? "✔" : "✖"} ${result}`);
  if (!ok) throw new Error(`Transaction failed: ${result} (hash: ${res.result.hash})`);
  return res;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const env = loadEnv();

const rlusdIssuer       = env.NEXT_PUBLIC_RLUSD_ISSUER;
const platformAddress   = env.PLATFORM_ISSUER_WALLET_ADDRESS;
const platformSeed      = env.PLATFORM_ISSUER_WALLET_SEED;

if (!rlusdIssuer || !platformAddress || !platformSeed) {
  console.error(
    "Missing env vars. Run `pnpm init:env` first.\n" +
    `  NEXT_PUBLIC_RLUSD_ISSUER         : ${rlusdIssuer ?? "MISSING"}\n` +
    `  PLATFORM_ISSUER_WALLET_ADDRESS   : ${platformAddress ?? "MISSING"}\n` +
    `  PLATFORM_ISSUER_WALLET_SEED      : ${platformSeed ? "***" : "MISSING"}`
  );
  process.exit(1);
}

const platformWallet = Wallet.fromSeed(platformSeed);

console.log("\n╔══════════════════════════════════════════════════╗");
console.log("║            RLUSD Faucet — devnet                 ║");
console.log("╚══════════════════════════════════════════════════╝");
console.log(`  RLUSD issuer    : ${rlusdIssuer}`);
console.log(`  Platform issuer : ${platformAddress}`);
console.log(`  Drop amount     : ${DROP_AMOUNT} RLUSD\n`);

const client = new Client(env.XRPL_NETWORK_ENDPOINT ?? DEVNET_WSS);
await client.connect();

// 1. Generate and fund new wallet
console.log("1. Generating new wallet via devnet faucet...");
const { wallet: newWallet } = await client.fundWallet(null, { faucetHost: DEVNET_FAUCET });
const balance = await client.getXrpBalance(newWallet.address);
console.log(`   Address : ${newWallet.address}`);
console.log(`   Seed    : ${newWallet.seed}`);
console.log(`   Balance : ${balance} XRP\n`);

// 2. Set trust line (new wallet → RLUSD issuer)
console.log("2. Setting RLUSD trust line...");
await submit(client, {
  TransactionType: "TrustSet",
  Account: newWallet.address,
  LimitAmount: {
    currency: CURRENCY,
    issuer:   rlusdIssuer,
    value:    TRUST_LIMIT,
  },
}, newWallet, `TrustSet ${newWallet.address} → issuer (limit ${TRUST_LIMIT})`);

// 3. Send RLUSD from platform issuer
console.log("\n3. Sending RLUSD from platform issuer...");
await submit(client, {
  TransactionType: "Payment",
  Account:     platformAddress,
  Destination: newWallet.address,
  Amount: {
    currency: CURRENCY,
    issuer:   rlusdIssuer,
    value:    DROP_AMOUNT,
  },
}, platformWallet, `Payment ${DROP_AMOUNT} RLUSD → ${newWallet.address}`);

await client.disconnect();

console.log("\n✅  Done!");
console.log("──────────────────────────────────────────────────");
console.log(`  Address : ${newWallet.address}`);
console.log(`  Seed    : ${newWallet.seed}`);
console.log(`  RLUSD   : ${DROP_AMOUNT}`);
console.log("──────────────────────────────────────────────────\n");
