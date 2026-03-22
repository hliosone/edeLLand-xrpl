import { Client } from "xrpl";
import { writeEnvVars } from "./env-writer.mjs";

const CREDENTIAL_TYPE_TEXT = "KYC_FULL";
const textToHex = (s) => Buffer.from(s, "utf8").toString("hex").toUpperCase();
export const CREDENTIAL_TYPE_HEX = textToHex(CREDENTIAL_TYPE_TEXT);

async function submit(client, tx, wallet, label) {
  console.log(`\n  → ${label}`);
  const res    = await client.submitAndWait(tx, { autofill: true, wallet });
  const result = res.result.meta.TransactionResult;
  const ok     = result === "tesSUCCESS";
  console.log(`    ${ok ? "✔" : "✖"} ${result} | ${res.result.hash}`);
  if (!ok) throw new Error(`Transaction failed: ${result}`);
  return res;
}

/**
 * Issues a KYC_ONE credential from PLATFORM_ISSUER_WALLET to PLATFORM_BROKER_WALLET,
 * then has the broker accept it.
 *
 * Writes to .env.local:
 *   NEXT_PUBLIC_CREDENTIAL_ISSUER  = PLATFORM_ISSUER address
 *   NEXT_PUBLIC_CREDENTIAL_TYPE    = hex-encoded KYC_ONE
 *
 * @param {object} ctx
 */
export async function setupCredentials(ctx) {
  const issuer = ctx.PLATFORM_ISSUER_WALLET;
  const broker = ctx.PLATFORM_BROKER_WALLET;

  if (!issuer || !broker) {
    throw new Error("ctx is missing PLATFORM_ISSUER_WALLET or PLATFORM_BROKER_WALLET");
  }

  console.log(`\n[setup-credentials] Issuer : ${issuer.address}`);
  console.log(`[setup-credentials] Subject: ${broker.address}`);
  console.log(`[setup-credentials] Type   : ${CREDENTIAL_TYPE_TEXT} (${CREDENTIAL_TYPE_HEX})`);

  const client = new Client(process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233");
  await client.connect();

  // 1. Issuer creates the KYC_ONE credential for the broker
  await submit(client, {
    TransactionType: "CredentialCreate",
    Account:         issuer.address,
    Subject:         broker.address,
    CredentialType:  CREDENTIAL_TYPE_HEX,
  }, issuer, `CredentialCreate — ${CREDENTIAL_TYPE_TEXT} issued to PLATFORM_BROKER`);

  // 2. Broker accepts the credential (makes it valid on-chain)
  await submit(client, {
    TransactionType: "CredentialAccept",
    Account:         broker.address,
    Issuer:          issuer.address,
    CredentialType:  CREDENTIAL_TYPE_HEX,
  }, broker, `CredentialAccept — PLATFORM_BROKER accepts ${CREDENTIAL_TYPE_TEXT}`);

  writeEnvVars({
    NEXT_PUBLIC_CREDENTIAL_ISSUER: issuer.address,
    NEXT_PUBLIC_CREDENTIAL_TYPE:   CREDENTIAL_TYPE_HEX,
  });

  await client.disconnect();
}
