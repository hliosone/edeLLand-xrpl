/**
 * Test setup — initialise le borrower depuis la mnemonic connue.
 *
 * Remplace l'étape 1 (1-setup-borrower.mjs) en réutilisant le wallet KYC existant
 * plutôt que d'en créer un nouveau. Utile pour tester end-to-end avec un compte
 * qui a déjà reçu la credential Edel-ID.
 *
 * Actions:
 *   - Dérive le wallet depuis la mnemonic
 *   - Finance depuis le faucet devnet si le solde XRP est insuffisant
 *   - Crée la trust line RLUSD si elle n'existe pas encore
 *   - Écrit BORROWER_WALLET_ADDRESS + BORROWER_WALLET_SEED dans .env.local
 *
 * Usage:
 *   node scripts/lending-protocol/setup-borrower-mnemonic.mjs
 *
 * Ensuite lancer le reste du flow :
 *   SKIP_BORROWER_SETUP=1 node scripts/lending-protocol/index.mjs
 */

import { Client, Wallet } from "xrpl";
import path from "path";
import fs   from "fs";
import { fileURLToPath } from "url";
import { writeEnvVars } from "../setup/env-writer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Env loader ────────────────────────────────────────────────────────────────
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
        (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
})();

// ── Config ────────────────────────────────────────────────────────────────────
const MNEMONIC = "neither barely enlist regular write cover exchange wrist two youth six sample kite twist casino aisle gap rural flight lab weather sock code item";

const DEVNET_WSS     = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";
const DEVNET_FAUCET  = "faucet.devnet.rippletest.net";
const RLUSD_CURRENCY = "524C555344000000000000000000000000000000";
const TRUST_LIMIT    = "1000000000";
const MIN_XRP_BALANCE = 20;

async function submit(client, tx, wallet, label) {
  console.log(`\n  → ${label}`);
  const res    = await client.submitAndWait(tx, { autofill: true, wallet });
  const result = res.result.meta.TransactionResult;
  const ok     = result === "tesSUCCESS";
  console.log(`    ${ok ? "✔" : "✖"} ${result} | ${res.result.hash}`);
  if (!ok) throw new Error(`Transaction failed: ${result}`);
  return res;
}

async function main() {
  const rlusdIssuer = process.env.RLUSD_ISSUER_WALLET_ADDRESS;
  if (!rlusdIssuer) {
    console.error("RLUSD_ISSUER_WALLET_ADDRESS not set — lance pnpm init:env d'abord.");
    process.exit(1);
  }

  const borrower = Wallet.fromMnemonic(MNEMONIC);
  console.log(`\n[setup-borrower-mnemonic]`);
  console.log(`  Address  : ${borrower.address}`);
  console.log(`  Seed     : ${borrower.seed}`);
  console.log(`  Endpoint : ${DEVNET_WSS}`);

  const client = new Client(DEVNET_WSS);
  await client.connect();

  const isLocal = DEVNET_WSS.includes("localhost") || DEVNET_WSS.includes("127.0.0.1");

  // ── 1. Vérifier / alimenter le wallet ────────────────────────────────────────
  let balance = 0;
  try {
    balance = parseFloat(await client.getXrpBalance(borrower.address));
  } catch {
    balance = 0;
  }
  console.log(`\n  Solde XRP actuel : ${balance} XRP`);

  if (balance < MIN_XRP_BALANCE) {
    console.log(`  Solde insuffisant — financement depuis le faucet devnet...`);
    const faucetPort = process.env.FAUCET_PORT ?? "7007";
    const fundOpts = isLocal
      ? { faucetHost: `localhost:${faucetPort}`, faucetPath: "/accounts", faucetProtocol: "http" }
      : { faucetHost: DEVNET_FAUCET };
    await client.fundWallet(borrower, fundOpts);
    balance = parseFloat(await client.getXrpBalance(borrower.address));
    console.log(`  ✔ Nouveau solde XRP : ${balance} XRP`);
  } else {
    console.log(`  ✔ Solde suffisant, pas de financement nécessaire.`);
  }

  // ── 2. Trust line RLUSD ───────────────────────────────────────────────────────
  let hasTrustLine = false;
  try {
    const lines = await client.request({
      command:      "account_lines",
      account:      borrower.address,
      ledger_index: "validated",
    });
    hasTrustLine = lines.result.lines.some(
      (l) => l.account === rlusdIssuer && l.currency === RLUSD_CURRENCY
    );
  } catch { /* compte peut-être pas encore visible */ }

  if (hasTrustLine) {
    console.log(`\n  ✔ Trust line RLUSD déjà présente — rien à faire.`);
  } else {
    await submit(client, {
      TransactionType: "TrustSet",
      Account:         borrower.address,
      LimitAmount: {
        currency: RLUSD_CURRENCY,
        issuer:   rlusdIssuer,
        value:    TRUST_LIMIT,
      },
    }, borrower, `TrustSet — trust line RLUSD vers ${rlusdIssuer}`);
  }

  // ── 3. Écrire dans .env.local ─────────────────────────────────────────────────
  writeEnvVars({
    BORROWER_WALLET_ADDRESS: borrower.address,
    BORROWER_WALLET_SEED:    borrower.seed,
  });

  console.log(`\n  Setup borrower terminé.`);
  console.log(`  Lance maintenant :`);
  console.log(`    SKIP_BORROWER_SETUP=1 node scripts/lending-protocol/index.mjs`);

  await client.disconnect();
}

main().catch((err) => {
  console.error("Erreur :", err.message);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
