import { Client, Wallet } from "xrpl";
import { NextResponse } from "next/server";

// Named credential types → hex (uppercase, no padding)
const CREDENTIAL_TYPES = {
  EDEL_KYC:  "4544454C5F4B5943",
  KYC_FULL:  "4B59435F46554C4C",
  KYC_OVER18:"4B59435F4F5645523138",
  KYC_TIER1: "4B59435F5449455231",
  KYC_TIER2: "4B59435F5449455232",
};

export async function POST(request) {
  const { subjectAddress, credentialType: credentialTypeParam } = await request.json();

  if (!subjectAddress) {
    return NextResponse.json({ error: "subjectAddress is required" }, { status: 400 });
  }

  const issuerSeed      = process.env.PLATFORM_ISSUER_WALLET_SEED;
  const networkEndpoint = process.env.XRPL_NETWORK_ENDPOINT || "wss://s.devnet.rippletest.net:51233";

  if (!issuerSeed) {
    return NextResponse.json({ error: "PLATFORM_ISSUER_WALLET_SEED not configured" }, { status: 500 });
  }

  // Resolve: named key > hex value > env default
  let credentialType;
  if (credentialTypeParam && CREDENTIAL_TYPES[credentialTypeParam]) {
    credentialType = CREDENTIAL_TYPES[credentialTypeParam];
  } else if (credentialTypeParam && /^[0-9A-Fa-f]+$/.test(credentialTypeParam)) {
    credentialType = credentialTypeParam.toUpperCase();
  } else {
    credentialType = process.env.NEXT_PUBLIC_CREDENTIAL_TYPE || "4B59435F4F4E45";
  }

  const client = new Client(networkEndpoint);

  try {
    await client.connect();
    const issuerWallet = Wallet.fromSeed(issuerSeed);

    const tx = {
      TransactionType: "CredentialCreate",
      Account:         issuerWallet.address,
      Subject:         subjectAddress,
      CredentialType:  credentialType,
    };

    const result   = await client.submitAndWait(tx, { autofill: true, wallet: issuerWallet });
    const txResult = result.result.meta?.TransactionResult;

    if (txResult !== "tesSUCCESS" && txResult !== "tecDUPLICATE") {
      throw new Error(`CredentialCreate failed: ${txResult}`);
    }

    return NextResponse.json({
      txHash:    result.result.hash,
      issuer:    issuerWallet.address,
      credentialType,
      duplicate: txResult === "tecDUPLICATE",
    });
  } catch (err) {
    console.error("[credential/issue]", err);
    return NextResponse.json({ error: err.message, detail: err.data ?? null }, { status: 500 });
  } finally {
    await client.disconnect();
  }
}
