import { Client, Wallet } from "xrpl";
import { NextResponse } from "next/server";

export async function POST(request) {
  const { subjectAddress } = await request.json();

  if (!subjectAddress) {
    return NextResponse.json({ error: "subjectAddress is required" }, { status: 400 });
  }

  const issuerSeed      = process.env.PLATFORM_ISSUER_WALLET_SEED;
  const credentialType  = process.env.NEXT_PUBLIC_YIELD_CREDENTIAL_TYPE || "4B59435F5949454C44";
  const networkEndpoint = process.env.XRPL_NETWORK_ENDPOINT || "wss://s.devnet.rippletest.net:51233";

  if (!issuerSeed) {
    return NextResponse.json({ error: "PLATFORM_ISSUER_WALLET_SEED not configured" }, { status: 500 });
  }

  const client = new Client(networkEndpoint);

  try {
    await client.connect();
    const issuerWallet = Wallet.fromSeed(issuerSeed);

    // Verify subject has the base KYC_ONE credential before issuing KYC_YIELD
    const kycOneType = process.env.NEXT_PUBLIC_CREDENTIAL_TYPE || "4B59435F4F4E45";
    const credsRes   = await client.request({
      command:      "account_objects",
      account:      subjectAddress,
      type:         "credential",
      ledger_index: "validated",
    });
    const hasSufficientKyc = (credsRes.result.account_objects ?? []).some(
      (c) => c.Issuer === issuerWallet.address &&
             c.CredentialType === kycOneType &&
             !!(c.Flags & 0x00010000) // lsfAccepted
    );
    if (!hasSufficientKyc) {
      return NextResponse.json({ error: "Subject does not have an accepted KYC_ONE credential" }, { status: 403 });
    }

    const tx = {
      TransactionType: "CredentialCreate",
      Account:         issuerWallet.address,
      Subject:         subjectAddress,
      CredentialType:  credentialType,
    };

    const result   = await client.submitAndWait(tx, { autofill: true, wallet: issuerWallet });
    const txResult = result.result.meta?.TransactionResult;

    if (txResult !== "tesSUCCESS") {
      throw new Error(`CredentialCreate failed: ${txResult}`);
    }

    return NextResponse.json({
      txHash:         result.result.hash,
      issuer:         issuerWallet.address,
      credentialType,
    });
  } catch (err) {
    console.error("[credential/issue-yield]", err);
    return NextResponse.json({ error: err.message, detail: err.data ?? null }, { status: 500 });
  } finally {
    await client.disconnect();
  }
}
