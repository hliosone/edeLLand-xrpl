import { Client, Wallet } from "xrpl";
import { NextResponse } from "next/server";

const EDEL_KYC_HEX    = "4544454C5F4B5943";
const networkEndpoint = () => process.env.XRPL_NETWORK_ENDPOINT || "wss://s.devnet.rippletest.net:51233";

export async function POST(request) {
  const { brokerAddress } = await request.json();

  if (!brokerAddress) {
    return NextResponse.json({ error: "brokerAddress is required" }, { status: 400 });
  }

  const issuerSeed = process.env.PLATFORM_ISSUER_WALLET_SEED;
  const brokerSeed = process.env.PLATFORM_BROKER_WALLET_SEED;

  if (!issuerSeed) {
    return NextResponse.json({ error: "PLATFORM_ISSUER_WALLET_SEED not configured" }, { status: 500 });
  }
  if (!brokerSeed) {
    return NextResponse.json({ error: "PLATFORM_BROKER_WALLET_SEED not configured" }, { status: 500 });
  }

  const client = new Client(networkEndpoint());

  try {
    await client.connect();
    const issuerWallet = Wallet.fromSeed(issuerSeed);
    const brokerWallet = Wallet.fromSeed(brokerSeed);

    // Verify the derived broker address matches what was passed
    if (brokerWallet.address !== brokerAddress) {
      return NextResponse.json(
        { error: `PLATFORM_BROKER_WALLET_SEED derives ${brokerWallet.address}, not ${brokerAddress}` },
        { status: 400 },
      );
    }

    // ── 1. CredentialCreate (issuer → broker) ─────────────────────────────
    const createTx = {
      TransactionType: "CredentialCreate",
      Account:         issuerWallet.address,
      Subject:         brokerAddress,
      CredentialType:  EDEL_KYC_HEX,
    };
    const createResult = await client.submitAndWait(createTx, { autofill: true, wallet: issuerWallet });
    const createTxResult = createResult.result.meta?.TransactionResult;
    if (createTxResult !== "tesSUCCESS") {
      throw new Error(`CredentialCreate failed: ${createTxResult}`);
    }

    // ── 2. CredentialAccept (broker signs) ────────────────────────────────
    const acceptTx = {
      TransactionType: "CredentialAccept",
      Account:         brokerAddress,
      Issuer:          issuerWallet.address,
      CredentialType:  EDEL_KYC_HEX,
    };
    const acceptResult = await client.submitAndWait(acceptTx, { autofill: true, wallet: brokerWallet });
    const acceptTxResult = acceptResult.result.meta?.TransactionResult;
    if (acceptTxResult !== "tesSUCCESS") {
      throw new Error(`CredentialAccept failed: ${acceptTxResult}`);
    }

    return NextResponse.json({
      ok:             true,
      issuer:         issuerWallet.address,
      broker:         brokerAddress,
      credentialType: EDEL_KYC_HEX,
      createHash:     createResult.result.hash,
      acceptHash:     acceptResult.result.hash,
    });
  } catch (err) {
    console.error("[admin/broker-credential]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    await client.disconnect();
  }
}
