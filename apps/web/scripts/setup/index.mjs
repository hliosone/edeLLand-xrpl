/**
 * edeLLand — full devnet setup (single script, no external imports)
 *
 * Run: pnpm init:env   (from apps/web)
 *
 * Wallets created & their roles:
 * ┌─────────────────────────┬────────────────────────────────────────────────────┐
 * │ PLATFORM_ISSUER_WALLET  │ Issues credentials · Vault owner · LoanBroker owner│
 * │ PLATFORM_BROKER_WALLET  │ Demo borrower (receives KYC + tier credentials)    │
 * │ RLUSD_ISSUER_WALLET     │ Mints RLUSD tokens                                 │
 * │ ORACLE_ADMIN_WALLET     │ Publishes on-chain XRP/USD price                   │
 * │ COLLATERAL_ESCROW_WALLET│ Holds XRP collateral for collateralised loans       │
 * └─────────────────────────┴────────────────────────────────────────────────────┘
 *
 * Key XLS-66 rule: LoanBroker.Owner MUST equal Vault.Owner.
 * → Both are PLATFORM_ISSUER_WALLET.
 * → LOAN_BROKER_WALLET_SEED is written as an alias for PLATFORM_ISSUER_WALLET_SEED.
 */

import { Client, Wallet, convertStringToHex } from "xrpl";
import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH  = path.resolve(__dirname, "../../.env.local");

const DEVNET_WSS    = "wss://s.devnet.rippletest.net:51233";
const DEVNET_FAUCET = "faucet.devnet.rippletest.net";
const ENDPOINT      = process.env.XRPL_NETWORK_ENDPOINT ?? DEVNET_WSS;
const IS_LOCAL      = ENDPOINT.includes("localhost") || ENDPOINT.includes("127.0.0.1");

// ── Token constants ───────────────────────────────────────────────────────────
const RLUSD_CURRENCY = "524C555344000000000000000000000000000000";
const RLUSD_AMOUNT   = "100000";    // minted to PLATFORM_ISSUER
const VAULT_SEED     = "10000";     // seeded into vault
const COVER_DEPOSIT  = "50";        // first-loss capital

// ── Credential types ──────────────────────────────────────────────────────────
const hex = (s) => Buffer.from(s, "utf8").toString("hex").toUpperCase();
const CRED = {
  KYC_FULL:   hex("KYC_FULL"),
  KYC_OVER18: hex("KYC_OVER18"),
  KYC_TIER1:  hex("KYC_TIER1"),
  KYC_TIER2:  hex("KYC_TIER2"),
};

// ── Oracle constants ──────────────────────────────────────────────────────────
const ORACLE_DOC_ID = 1;
const ORACLE_SCALE  = 6;

// ── Helpers ───────────────────────────────────────────────────────────────────

function writeEnv(vars) {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  for (const [k, v] of Object.entries(vars)) {
    const escaped = String(v).includes(" ") ? `"${v}"` : String(v);
    const line    = `${k}=${escaped}`;
    const regex   = new RegExp(`^${k}=.*$`, "m");
    content       = regex.test(content)
      ? content.replace(regex, line)
      : (content ? `${content.trimEnd()}\n${line}\n` : `${line}\n`);
  }
  fs.writeFileSync(ENV_PATH, content, "utf8");
  console.log(`  ✔ .env.local → ${Object.keys(vars).join(", ")}`);
}

async function submit(client, tx, wallet, label) {
  process.stdout.write(`  → ${label} … `);
  const res    = await client.submitAndWait(tx, { autofill: true, wallet });
  const result = res.result.meta?.TransactionResult ?? res.result.engine_result;
  const ok     = result === "tesSUCCESS";
  console.log(`${ok ? "✔" : "✖"} ${result}`);
  if (!ok) throw new Error(`TX failed: ${result}`);
  return res;
}

async function fundWallet(client, label) {
  const faucetOpts = IS_LOCAL
    ? { faucetHost: `localhost:${process.env.FAUCET_PORT ?? "7007"}`, faucetPath: "/accounts", faucetProtocol: "http" }
    : { faucetHost: DEVNET_FAUCET };

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { wallet } = await client.fundWallet(null, faucetOpts);
      console.log(`  ${label.padEnd(26)} ${wallet.address}`);
      return wallet;
    } catch (err) {
      if (attempt === 3) throw err;
      console.log(`  ⚠ faucet retry ${attempt}/3 (${err.message})`);
      await sleep(4_000);
    }
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchObjectId(client, owner, type, sequence) {
  const res = await client.request({ command: "account_objects", account: owner, ledger_index: "validated", type });
  const all = res.result.account_objects ?? [];
  return (all.find((o) => o.Sequence === sequence) ?? all.reduce((a, b) => (!a || b.Sequence > a.Sequence ? b : a), null))?.index ?? null;
}

async function fetchLiveXrpPrice() {
  try {
    const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=XRPUSDT");
    const p = parseFloat((await r.json()).price);
    if (p && !isNaN(p)) return p;
  } catch {}
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ripple&vs_currencies=usd");
    const p = (await r.json())?.ripple?.usd;
    if (p) return p;
  } catch {}
  return 2.50; // static fallback
}

// ── Step log ──────────────────────────────────────────────────────────────────

function step(n, total, name) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`[${n}/${total}] ${name}`);
  console.log("─".repeat(60));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║       edeLLand devnet setup          ║");
  console.log("╚══════════════════════════════════════╝\n");

  const TOTAL = 7;
  const client = new Client(ENDPOINT);
  await client.connect();
  writeEnv({ XRPL_NETWORK_ENDPOINT: ENDPOINT });

  // ════════════════════════════════════════════════════
  // 1. Create & fund all wallets
  // ════════════════════════════════════════════════════
  step(1, TOTAL, "Create & fund XRPL wallets");

  const PLATFORM_ISSUER    = await fundWallet(client, "Platform Issuer");
  await sleep(2_000);
  const PLATFORM_BROKER    = await fundWallet(client, "Platform Broker");
  await sleep(2_000);
  const RLUSD_ISSUER       = await fundWallet(client, "RLUSD Issuer");
  await sleep(2_000);
  const ORACLE_ADMIN       = await fundWallet(client, "Oracle Admin");
  await sleep(2_000);
  const COLLATERAL_ESCROW  = await fundWallet(client, "Collateral Escrow");

  writeEnv({
    PLATFORM_ISSUER_WALLET_ADDRESS:   PLATFORM_ISSUER.address,
    PLATFORM_ISSUER_WALLET_SEED:      PLATFORM_ISSUER.seed,
    PLATFORM_BROKER_WALLET_ADDRESS:   PLATFORM_BROKER.address,
    PLATFORM_BROKER_WALLET_SEED:      PLATFORM_BROKER.seed,
    NEXT_PUBLIC_PLATFORM_BROKER_WALLET_ADDRESS: PLATFORM_BROKER.address,
    RLUSD_ISSUER_WALLET_ADDRESS:      RLUSD_ISSUER.address,
    RLUSD_ISSUER_WALLET_SEED:         RLUSD_ISSUER.seed,
    ORACLE_ADMIN_WALLET_ADDRESS:      ORACLE_ADMIN.address,
    ORACLE_ADMIN_WALLET_SEED:         ORACLE_ADMIN.seed,
    COLLATERAL_ESCROW_WALLET_ADDRESS: COLLATERAL_ESCROW.address,
    COLLATERAL_ESCROW_WALLET_SEED:    COLLATERAL_ESCROW.seed,
  });

  // ════════════════════════════════════════════════════
  // 2. Setup RLUSD (enable DefaultRipple, TrustSet, mint)
  // ════════════════════════════════════════════════════
  step(2, TOTAL, "Setup RLUSD issuer + fund platform");

  await submit(client, {
    TransactionType: "AccountSet",
    Account:         RLUSD_ISSUER.address,
    SetFlag:         8, // asfDefaultRipple
  }, RLUSD_ISSUER, "AccountSet — DefaultRipple on RLUSD issuer");

  await submit(client, {
    TransactionType: "TrustSet",
    Account:         PLATFORM_ISSUER.address,
    LimitAmount:     { currency: RLUSD_CURRENCY, issuer: RLUSD_ISSUER.address, value: "1000000000" },
  }, PLATFORM_ISSUER, "TrustSet — PLATFORM_ISSUER trusts RLUSD");

  await submit(client, {
    TransactionType: "Payment",
    Account:         RLUSD_ISSUER.address,
    Destination:     PLATFORM_ISSUER.address,
    Amount:          { currency: RLUSD_CURRENCY, issuer: RLUSD_ISSUER.address, value: RLUSD_AMOUNT },
  }, RLUSD_ISSUER, `Payment — mint ${RLUSD_AMOUNT} RLUSD → PLATFORM_ISSUER`);

  writeEnv({ NEXT_PUBLIC_RLUSD_ISSUER: RLUSD_ISSUER.address });

  // ════════════════════════════════════════════════════
  // 3. Issue credentials to PLATFORM_BROKER (demo borrower)
  //    KYC_FULL + KYC_OVER18 + KYC_TIER2
  // ════════════════════════════════════════════════════
  step(3, TOTAL, "Issue KYC credentials to Platform Broker");

  for (const [name, credHex] of Object.entries(CRED)) {
    await submit(client, {
      TransactionType: "CredentialCreate",
      Account:         PLATFORM_ISSUER.address,
      Subject:         PLATFORM_BROKER.address,
      CredentialType:  credHex,
    }, PLATFORM_ISSUER, `CredentialCreate — ${name}`);

    await submit(client, {
      TransactionType: "CredentialAccept",
      Account:         PLATFORM_BROKER.address,
      Issuer:          PLATFORM_ISSUER.address,
      CredentialType:  credHex,
    }, PLATFORM_BROKER, `CredentialAccept — ${name}`);
  }

  writeEnv({
    NEXT_PUBLIC_CREDENTIAL_ISSUER: PLATFORM_ISSUER.address,
    NEXT_PUBLIC_CREDENTIAL_TYPE:   CRED.KYC_FULL,
  });

  // ════════════════════════════════════════════════════
  // 4. Setup permissioned domain + private RLUSD vault
  //    Owner = PLATFORM_ISSUER (will also own LoanBroker)
  // ════════════════════════════════════════════════════
  step(4, TOTAL, "Setup permissioned domain + RLUSD vault");

  const domainRes = await submit(client, {
    TransactionType:      "PermissionedDomainSet",
    Account:              PLATFORM_ISSUER.address,
    AcceptedCredentials:  [{ Credential: { Issuer: PLATFORM_ISSUER.address, CredentialType: CRED.KYC_FULL } }],
  }, PLATFORM_ISSUER, "PermissionedDomainSet — KYC_FULL gated domain");

  const domainId = await fetchObjectId(client, PLATFORM_ISSUER.address, "permissioned_domain", domainRes.result.tx_json.Sequence);
  if (!domainId) throw new Error("DomainID not found");
  console.log(`  DomainID : ${domainId}`);
  writeEnv({ PERMISSIONED_DOMAIN_ID: domainId, NEXT_PUBLIC_PERMISSIONED_DOMAIN_ID: domainId });

  const vaultRes = await submit(client, {
    TransactionType:  "VaultCreate",
    Account:          PLATFORM_ISSUER.address,
    Asset:            { currency: RLUSD_CURRENCY, issuer: RLUSD_ISSUER.address },
    WithdrawalPolicy: 1,
    Flags:            0x00010000, // tfVaultPrivate
    DomainID:         domainId,
  }, PLATFORM_ISSUER, "VaultCreate — private RLUSD vault (KYC_FULL required)");

  const vaultId = await fetchObjectId(client, PLATFORM_ISSUER.address, "vault", vaultRes.result.tx_json.Sequence);
  if (!vaultId) throw new Error("VaultID not found");
  console.log(`  VaultID  : ${vaultId}`);
  writeEnv({ PERMISSIONED_VAULT_ID: vaultId, NEXT_PUBLIC_PERMISSIONED_VAULT_ID: vaultId });

  await submit(client, {
    TransactionType: "VaultDeposit",
    Account:         PLATFORM_ISSUER.address,
    VaultID:         vaultId,
    Amount:          { currency: RLUSD_CURRENCY, issuer: RLUSD_ISSUER.address, value: VAULT_SEED },
  }, PLATFORM_ISSUER, `VaultDeposit — seed ${VAULT_SEED} RLUSD`);

  // Resolve share MPT ID
  try {
    const state = (await client.request({ command: "ledger_entry", index: vaultId, ledger_index: "validated" })).result.node;
    let mptId = state.ShareMPTID ?? state.MPTokenIssuanceID ?? state.LPTokenIssuanceID ?? null;
    if (!mptId) {
      const objs = (await client.request({ command: "account_objects", account: PLATFORM_ISSUER.address, type: "mpt_issuance", ledger_index: "validated" })).result.account_objects ?? [];
      mptId = objs[0]?.index ?? objs[0]?.MPTokenIssuanceID ?? null;
    }
    if (mptId) writeEnv({ NEXT_PUBLIC_MPT_ISSUANCE_ID: mptId });
    console.log(`  Vault    : ${state.AssetsTotal} RLUSD total · private ✔`);
  } catch {}

  // ════════════════════════════════════════════════════
  // 5. Setup LoanBroker
  //    Owner = PLATFORM_ISSUER (= vault owner, per XLS-66)
  //    LOAN_BROKER_WALLET_SEED written as alias
  // ════════════════════════════════════════════════════
  step(5, TOTAL, "Setup LoanBroker (vault owner = broker owner)");

  const brokerSetRes = await submit(client, {
    TransactionType:      "LoanBrokerSet",
    Account:              PLATFORM_ISSUER.address, // MUST = Vault.Owner
    VaultID:              vaultId,
    ManagementFeeRate:    0,
    DebtMaximum:          "0",
    CoverRateMinimum:     0,
    CoverRateLiquidation: 0,
  }, PLATFORM_ISSUER, "LoanBrokerSet — create LoanBroker");

  const loanBrokerId = await fetchObjectId(client, PLATFORM_ISSUER.address, "loan_broker", brokerSetRes.result.tx_json.Sequence);
  if (!loanBrokerId) throw new Error("LoanBrokerID not found");
  console.log(`  LoanBrokerID : ${loanBrokerId}`);

  await submit(client, {
    TransactionType: "LoanBrokerCoverDeposit",
    Account:         PLATFORM_ISSUER.address,
    LoanBrokerID:    loanBrokerId,
    Amount:          { currency: RLUSD_CURRENCY, issuer: RLUSD_ISSUER.address, value: COVER_DEPOSIT },
  }, PLATFORM_ISSUER, `LoanBrokerCoverDeposit — ${COVER_DEPOSIT} RLUSD first-loss capital`);

  writeEnv({
    LOAN_BROKER_ID:             loanBrokerId,
    NEXT_PUBLIC_LOAN_BROKER_ID: loanBrokerId,
    // LOAN_BROKER_WALLET_* = alias for PLATFORM_ISSUER (vault owner = broker owner)
    LOAN_BROKER_WALLET_ADDRESS: PLATFORM_ISSUER.address,
    LOAN_BROKER_WALLET_SEED:    PLATFORM_ISSUER.seed,
  });

  // ════════════════════════════════════════════════════
  // 6. Setup price oracle (XRP/USD)
  // ════════════════════════════════════════════════════
  step(6, TOTAL, "Setup price oracle (XRP/USD)");

  const xrpPrice = await fetchLiveXrpPrice();
  console.log(`  Live XRP/USD : $${xrpPrice}`);

  await submit(client, {
    TransactionType:  "OracleSet",
    Account:          ORACLE_ADMIN.address,
    OracleDocumentID: ORACLE_DOC_ID,
    Provider:         convertStringToHex("edeLLand"),
    AssetClass:       convertStringToHex("currency"),
    LastUpdateTime:   Math.floor(Date.now() / 1000),
    PriceDataSeries: [
      { PriceData: { BaseAsset: "XRP", QuoteAsset: "USD", AssetPrice: Math.round(xrpPrice * Math.pow(10, ORACLE_SCALE)), Scale: ORACLE_SCALE } },
    ],
  }, ORACLE_ADMIN, `OracleSet — XRP/USD = $${xrpPrice}`);

  writeEnv({
    NEXT_PUBLIC_ORACLE_ADDRESS:     ORACLE_ADMIN.address,
    NEXT_PUBLIC_ORACLE_DOCUMENT_ID: String(ORACLE_DOC_ID),
  });

  // ════════════════════════════════════════════════════
  // 7. Summary
  // ════════════════════════════════════════════════════
  step(7, TOTAL, "Done — summary");

  console.log(`
  Wallet roles
  ────────────────────────────────────────────────────
  Platform Issuer    ${PLATFORM_ISSUER.address}
    = Vault owner, LoanBroker owner, credential issuer

  Platform Broker    ${PLATFORM_BROKER.address}
    = Demo borrower (KYC_FULL + KYC_OVER18 + KYC_TIER1 + KYC_TIER2)

  RLUSD Issuer       ${RLUSD_ISSUER.address}
  Oracle Admin       ${ORACLE_ADMIN.address}
  Collateral Escrow  ${COLLATERAL_ESCROW.address}
    = Holds XRP collateral · co-signer on borrower wallets

  LoanBroker ID      ${loanBrokerId}
  Vault ID           ${vaultId}
  XRP/USD oracle     $${xrpPrice} (doc ${ORACLE_DOC_ID})
  ────────────────────────────────────────────────────

  Next: pnpm dev → http://localhost:3000
  `);

  await client.disconnect();
}

main().catch((err) => {
  console.error("\n✖ Setup failed:", err.message);
  process.exit(1);
});
