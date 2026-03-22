import { Client } from "xrpl";
import { writeEnvVars } from "./env-writer.mjs";
import { CREDENTIAL_TYPE_HEX } from "./setup-credentials.mjs";
import { CURRENCY } from "./setup-rlusd.mjs";

const SEED_RLUSD = 10000;

async function submit(client, tx, wallet, label) {
  console.log(`\n  → ${label}`);
  const res    = await client.submitAndWait(tx, { autofill: true, wallet });
  const result = res.result.meta.TransactionResult;
  const ok     = result === "tesSUCCESS";
  console.log(`    ${ok ? "✔" : "✖"} ${result} | ${res.result.hash}`);
  if (!ok) throw new Error(`Transaction failed: ${result}`);
  return res;
}

async function fetchObjectId(client, owner, type, sequence) {
  const res = await client.request({
    command:      "account_objects",
    account:      owner,
    ledger_index: "validated",
    type,
  });
  const obj = res.result.account_objects.find((o) => o.Sequence === sequence);
  if (obj) return obj.index;
  // fallback: pick the most recent one
  const all = res.result.account_objects;
  if (!all.length) return null;
  return all.reduce((a, b) => (a.Sequence > b.Sequence ? a : b)).index;
}

/**
 * Creates a PermissionedDomain + a private RLUSD Vault linked to it.
 *
 * Steps:
 *   1. PermissionedDomainSet — accepts KYC_ONE from PLATFORM_ISSUER
 *   2. VaultCreate (tfVaultPrivate) — RLUSD vault gated by the domain
 *   3. VaultDeposit — seed 10 000 RLUSD from PLATFORM_ISSUER (owner bypass)
 *
 * Writes to .env.local:
 *   PERMISSIONED_DOMAIN_ID / NEXT_PUBLIC_PERMISSIONED_DOMAIN_ID
 *   PERMISSIONED_VAULT_ID  / NEXT_PUBLIC_PERMISSIONED_VAULT_ID
 *
 * @param {object} ctx - must contain PLATFORM_ISSUER_WALLET and RLUSD_ISSUER_WALLET
 */
export async function setupPermissionedVault(ctx) {
  const issuer      = ctx.PLATFORM_ISSUER_WALLET;
  const rlusdIssuer = ctx.RLUSD_ISSUER_WALLET;

  if (!issuer || !rlusdIssuer) {
    throw new Error("ctx is missing PLATFORM_ISSUER_WALLET or RLUSD_ISSUER_WALLET");
  }

  console.log(`\n[setup-permissioned-vault] Owner: ${issuer.address}`);

  const client = new Client(process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233");
  await client.connect();

  // ── 1. Permissioned Domain ────────────────────────────────────────────────
  const domainRes = await submit(client, {
    TransactionType:      "PermissionedDomainSet",
    Account:              issuer.address,
    AcceptedCredentials: [
      {
        Credential: {
          Issuer:         issuer.address,
          CredentialType: CREDENTIAL_TYPE_HEX,
        },
      },
    ],
  }, issuer, "PermissionedDomainSet — KYC_FULL gated domain");

  const domainSeq = domainRes.result.tx_json.Sequence;
  console.log(`\n  Fetching DomainID (seq ${domainSeq})...`);
  const domainId = await fetchObjectId(client, issuer.address, "permissioned_domain", domainSeq);
  if (!domainId) throw new Error("DomainID not found after PermissionedDomainSet");
  console.log(`    DomainID: ${domainId}`);

  writeEnvVars({
    PERMISSIONED_DOMAIN_ID:              domainId,
    NEXT_PUBLIC_PERMISSIONED_DOMAIN_ID:  domainId,
  });

  // Expose on ctx for downstream steps
  ctx.PERMISSIONED_DOMAIN_ID = domainId;

  // ── 2. Private Vault ──────────────────────────────────────────────────────
  // tfVaultPrivate = 0x00010000 — only domain-credentialed accounts can deposit
  const vaultRes = await submit(client, {
    TransactionType:  "VaultCreate",
    Account:          issuer.address,
    Asset:            { currency: CURRENCY, issuer: rlusdIssuer.address },
    WithdrawalPolicy: 1,          // First Come First Serve
    Flags:            0x00010000, // tfVaultPrivate
    DomainID:         domainId,
  }, issuer, "VaultCreate — private RLUSD vault (KYC_FULL required)");

  const vaultSeq = vaultRes.result.tx_json.Sequence;
  console.log(`\n  Fetching VaultID (seq ${vaultSeq})...`);
  const vaultId = await fetchObjectId(client, issuer.address, "vault", vaultSeq);
  if (!vaultId) throw new Error("VaultID not found after VaultCreate");
  console.log(`    VaultID: ${vaultId}`);

  writeEnvVars({
    PERMISSIONED_VAULT_ID:              vaultId,
    NEXT_PUBLIC_PERMISSIONED_VAULT_ID:  vaultId,
  });

  ctx.PERMISSIONED_VAULT_ID = vaultId;

  // ── 3. Seed deposit (owner bypasses domain check per XLS-65 §1.1.2) ──────
  await submit(client, {
    TransactionType: "VaultDeposit",
    Account:         issuer.address,
    VaultID:         vaultId,
    Amount:          { currency: CURRENCY, issuer: rlusdIssuer.address, value: String(SEED_RLUSD) },
  }, issuer, `VaultDeposit — seed ${SEED_RLUSD} RLUSD from owner`);

  // ── Final state + write MPT issuance ID ──────────────────────────────────
  try {
    const state = (await client.request({ command: "ledger_entry", index: vaultId, ledger_index: "validated" })).result.node;
    const total = state.AssetsTotal ?? "0";
    console.log(`\n  Vault state:`);
    console.log(`    AssetsTotal    : ${total} RLUSD`);
    console.log(`    AssetsAvailable: ${state.AssetsAvailable} RLUSD`);
    console.log(`    Private        : ${state.Flags & 0x00010000 ? "yes ✔" : "no"}`);

    // Resolve MPT issuance ID from all known field variants
    let shareMPTID =
      state.ShareMPTID        ??
      state.MPTokenIssuanceID ??
      state.LPTokenIssuanceID ??
      state.ShareToken        ??
      null;

    // Fallback: query owner's mpt_issuance objects
    if (!shareMPTID) {
      try {
        const objRes   = await client.request({ command: "account_objects", account: issuer.address, type: "mpt_issuance", ledger_index: "validated" });
        const issuances = objRes.result.account_objects ?? [];
        shareMPTID = issuances[0]?.index ?? issuances[0]?.MPTokenIssuanceID ?? null;
      } catch { /* ignore */ }
    }

    console.log(`    ShareMPTID     : ${shareMPTID ?? "N/A"}`);

    if (shareMPTID) {
      writeEnvVars({
        NEXT_PUBLIC_MPT_ISSUANCE_ID: shareMPTID,
      });
      ctx.MPT_ISSUANCE_ID = shareMPTID;
    }
  } catch {
    // non-fatal
  }

  await client.disconnect();
}
