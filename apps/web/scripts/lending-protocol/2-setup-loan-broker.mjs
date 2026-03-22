/**
 * Step 2 — Create LoanBroker and fund first-loss capital.
 *
 * Important: per XLS-66, Vault.Owner === LoanBroker.Owner.
 * The existing PERMISSIONED_VAULT_ID was created by PLATFORM_ISSUER,
 * so PLATFORM_ISSUER must be the LoanBroker.Owner here.
 *
 * Actions:
 *   1. LoanBrokerSet — link LoanBroker to the existing RLUSD vault
 *   2. LoanBrokerCoverDeposit — fund first-loss capital (optional cover;
 *      CoverRateMinimum = 0 so no minimum is enforced)
 *
 * Writes to .env.local:
 *   LOAN_BROKER_ID
 *   NEXT_PUBLIC_LOAN_BROKER_ID
 */

import { Client, Wallet } from "xrpl";
import { writeEnvVars } from "../setup/env-writer.mjs";

const RLUSD_CURRENCY = "524C555344000000000000000000000000000000";

// First-loss capital to deposit (RLUSD). CoverRateMinimum = 0 means this is
// voluntary — it can be used to cover defaults if it exists.
const COVER_DEPOSIT_RLUSD = "50";

async function submit(client, tx, wallet, label) {
  console.log(`\n  → ${label}`);
  const res    = await client.submitAndWait(tx, { autofill: true, wallet });
  const result = res.result.meta.TransactionResult;
  const ok     = result === "tesSUCCESS";
  console.log(`    ${ok ? "✔" : "✖"} ${result} | ${res.result.hash}`);
  if (!ok) throw new Error(`Transaction failed: ${result}`);
  return res;
}

async function fetchLoanBrokerId(client, ownerAddress, sequence) {
  const res = await client.request({
    command:      "account_objects",
    account:      ownerAddress,
    ledger_index: "validated",
    type:         "loan_broker",
  });
  const obj = res.result.account_objects.find((o) => o.Sequence === sequence);
  if (obj) return obj.index;
  // fallback: most recent
  const all = res.result.account_objects;
  if (!all.length) return null;
  return all.reduce((a, b) => (a.Sequence > b.Sequence ? a : b)).index;
}

export async function setupLoanBroker(ctx) {
  const DEVNET_WSS = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";

  // Per XLS-66: LoanBroker.Owner MUST equal Vault.Owner.
  // The vault is created by PLATFORM_ISSUER_WALLET, so the LoanBroker must use the same wallet.
  const issuer      = ctx.PLATFORM_ISSUER_WALLET ?? Wallet.fromSeed(process.env.PLATFORM_ISSUER_WALLET_SEED);
  const rlusdIssuer = ctx.RLUSD_ISSUER_WALLET?.address ?? process.env.RLUSD_ISSUER_WALLET_ADDRESS;
  const vaultId     = ctx.PERMISSIONED_VAULT_ID ?? process.env.PERMISSIONED_VAULT_ID;

  if (!issuer || !rlusdIssuer || !vaultId) {
    throw new Error(
      "Missing values: PLATFORM_ISSUER_WALLET_SEED, RLUSD_ISSUER_WALLET_ADDRESS, or PERMISSIONED_VAULT_ID. " +
      "Run pnpm init:env first."
    );
  }
  console.log(`\n[setup-loan-broker] LoanBroker.Owner (vault owner): ${issuer.address}`);
  console.log(`[setup-loan-broker] Vault: ${vaultId}`);

  const client = new Client(DEVNET_WSS);
  await client.connect();

  // ── 1. LoanBrokerSet ─────────────────────────────────────────────────────────
  // CoverRateMinimum = 0 & CoverRateLiquidation = 0 → no cover floor enforced.
  // ManagementFeeRate = 0 → no management fee for demo simplicity.
  const setRes = await submit(client, {
    TransactionType:       "LoanBrokerSet",
    Account:               issuer.address,
    VaultID:               vaultId,
    ManagementFeeRate:     0,
    DebtMaximum:           "0",     // 0 = no limit
    CoverRateMinimum:      0,
    CoverRateLiquidation:  0,
  }, issuer, "LoanBrokerSet — create LoanBroker linked to RLUSD vault");

  const loanBrokerSeq = setRes.result.tx_json.Sequence;
  console.log(`\n  Fetching LoanBrokerID (seq ${loanBrokerSeq})...`);
  const loanBrokerId = await fetchLoanBrokerId(client, issuer.address, loanBrokerSeq);
  if (!loanBrokerId) throw new Error("LoanBrokerID not found after LoanBrokerSet");
  console.log(`    LoanBrokerID: ${loanBrokerId}`);

  // Write broker ID + expose LOAN_BROKER_WALLET_* as alias for PLATFORM_ISSUER_WALLET_*
  // (routes use LOAN_BROKER_WALLET_SEED; vault owner = loan broker owner per XLS-66)
  writeEnvVars({
    LOAN_BROKER_ID:               loanBrokerId,
    NEXT_PUBLIC_LOAN_BROKER_ID:   loanBrokerId,
    LOAN_BROKER_WALLET_ADDRESS:   issuer.address,
    LOAN_BROKER_WALLET_SEED:      issuer.seed,
  });

  // ── 2. LoanBrokerCoverDeposit ────────────────────────────────────────────────
  // Fund first-loss capital from PLATFORM_ISSUER's RLUSD balance.
  await submit(client, {
    TransactionType: "LoanBrokerCoverDeposit",
    Account:         issuer.address,
    LoanBrokerID:    loanBrokerId,
    Amount: {
      currency: RLUSD_CURRENCY,
      issuer:   rlusdIssuer,
      value:    COVER_DEPOSIT_RLUSD,
    },
  }, issuer, `LoanBrokerCoverDeposit — ${COVER_DEPOSIT_RLUSD} RLUSD first-loss capital`);

  // ── Final state ───────────────────────────────────────────────────────────────
  try {
    const broker = (await client.request({
      command:      "ledger_entry",
      index:        loanBrokerId,
      ledger_index: "validated",
    })).result.node;
    console.log(`\n  LoanBroker state:`);
    console.log(`    Account (pseudo): ${broker.Account}`);
    console.log(`    CoverAvailable  : ${broker.CoverAvailable} RLUSD`);
    console.log(`    DebtTotal       : ${broker.DebtTotal}`);
    console.log(`    OwnerCount      : ${broker.OwnerCount}`);
  } catch { /* non-fatal */ }

  await client.disconnect();

  ctx.LOAN_BROKER_ID         = loanBrokerId;
  ctx.LOAN_BROKER_WALLET     = issuer;
  return { LOAN_BROKER_ID: loanBrokerId, LOAN_BROKER_WALLET: issuer };
}
