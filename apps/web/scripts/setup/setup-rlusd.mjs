import { Client } from "xrpl";
import { writeEnvVars } from "./env-writer.mjs";

// XRPL requires non-3-char currencies as 40-char hex (right-padded with zeros)
// "RLUSD" → 0x524C555344 padded to 20 bytes
export const CURRENCY = "524C555344000000000000000000000000000000";
const TRUST_LIMIT = "1000000000";
const ISSUE_AMOUNT = "100000";

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
 * Setup RLUSD issuer and fund PLATFORM_ISSUER with 10 000 RLUSD.
 *
 * Steps:
 *   1. Enable DefaultRipple on RLUSD_ISSUER_WALLET
 *   2. PLATFORM_ISSUER_WALLET creates a TrustSet → RLUSD_ISSUER_WALLET
 *   3. RLUSD_ISSUER_WALLET sends 10 000 RLUSD to PLATFORM_ISSUER_WALLET
 *   4. Write NEXT_PUBLIC_RLUSD_ISSUER to .env.local
 *
 * @param {object} ctx - must contain RLUSD_ISSUER_WALLET and PLATFORM_ISSUER_WALLET
 */
export async function setupRLUSD(ctx) {
  const issuer          = ctx.RLUSD_ISSUER_WALLET;
  const platformIssuer  = ctx.PLATFORM_ISSUER_WALLET;

  if (!issuer || !platformIssuer) {
    throw new Error("ctx is missing RLUSD_ISSUER_WALLET or PLATFORM_ISSUER_WALLET — run createAccounts first");
  }

  console.log(`\n[setup-rlusd] RLUSD Issuer   : ${issuer.address}`);
  console.log(`[setup-rlusd] Platform Issuer : ${platformIssuer.address}`);

  const client = new Client(process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233");
  await client.connect();

  // 1. Enable DefaultRipple on the issuer so RLUSD can ripple through paths
  await submit(client, {
    TransactionType: "AccountSet",
    Account:         issuer.address,
    SetFlag:         8, // asfDefaultRipple
  }, issuer, "AccountSet — enable DefaultRipple on RLUSD issuer");

  // 2. Platform issuer sets a trust line toward the RLUSD issuer
  await submit(client, {
    TransactionType: "TrustSet",
    Account:         platformIssuer.address,
    LimitAmount: {
      currency: CURRENCY,
      issuer:   issuer.address,
      value:    TRUST_LIMIT,
    },
  }, platformIssuer, `TrustSet — PLATFORM_ISSUER trusts ${CURRENCY} from RLUSD issuer (limit ${TRUST_LIMIT})`);

  // 3. RLUSD issuer sends 10 000 RLUSD to platform issuer
  await submit(client, {
    TransactionType: "Payment",
    Account:         issuer.address,
    Destination:     platformIssuer.address,
    Amount: {
      currency: CURRENCY,
      issuer:   issuer.address,
      value:    ISSUE_AMOUNT,
    },
  }, issuer, `Payment — mint ${ISSUE_AMOUNT} ${CURRENCY} → PLATFORM_ISSUER`);

  // 4. Persist issuer address as a public env var
  writeEnvVars({ NEXT_PUBLIC_RLUSD_ISSUER: issuer.address });

  await client.disconnect();
}
