/**
 * Standalone script — accept a pending CredentialCreate on-chain.
 *
 * Usage:
 *   node scripts/accept-credential.mjs
 *
 * Reads from .env.local:
 *   XRPL_NETWORK_ENDPOINT
 *   NEXT_PUBLIC_CREDENTIAL_ISSUER
 *   NEXT_PUBLIC_CREDENTIAL_TYPE
 */

import { Client, Wallet } from "xrpl";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local manually (no dotenv dependency)
try {
  const envPath = resolve(__dirname, "../.env.local");
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
} catch {
  // no .env.local, rely on actual env
}

const MNEMONIC = "neither barely enlist regular write cover exchange wrist two youth six sample kite twist casino aisle gap rural flight lab weather sock code item";

const ENDPOINT        = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";
const ISSUER          = process.env.NEXT_PUBLIC_CREDENTIAL_ISSUER;
const CREDENTIAL_TYPE = "4B59435F46554C4C"; // KYC_FULL — found on-chain

if (!ISSUER) {
  console.error("NEXT_PUBLIC_CREDENTIAL_ISSUER not set in .env.local");
  process.exit(1);
}

const subject = Wallet.fromMnemonic(MNEMONIC);
console.log(`Subject address : ${subject.address}`);
console.log(`Issuer          : ${ISSUER}`);
console.log(`CredentialType  : ${CREDENTIAL_TYPE}`);
console.log(`Endpoint        : ${ENDPOINT}\n`);

const client = new Client(ENDPOINT);
await client.connect();

const tx = {
  TransactionType: "CredentialAccept",
  Account:         subject.address,
  Issuer:          ISSUER,
  CredentialType:  CREDENTIAL_TYPE,
};

console.log("→ Submitting CredentialAccept...");
const res    = await client.submitAndWait(tx, { autofill: true, wallet: subject });
const result = res.result.meta.TransactionResult;
const ok     = result === "tesSUCCESS";

console.log(`  ${ok ? "✔" : "✖"} ${result} | ${res.result.hash}`);

if (!ok) {
  console.error("Transaction failed:", result);
  process.exit(1);
}

console.log("\nCredential accepted successfully.");
await client.disconnect();
