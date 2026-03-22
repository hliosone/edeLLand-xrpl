import { Client, Wallet } from "xrpl";
import { NextResponse } from "next/server";

const NETWORK   = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";
const DOMAIN_ID = process.env.PERMISSIONED_DOMAIN_ID;

export async function POST() {
  const issuerSeed          = process.env.PLATFORM_ISSUER_WALLET_SEED;
  const issuerAddress       = process.env.PLATFORM_ISSUER_WALLET_ADDRESS;
  const credentialType      = process.env.NEXT_PUBLIC_CREDENTIAL_TYPE;

  if (!issuerSeed)     return NextResponse.json({ error: "PLATFORM_ISSUER_WALLET_SEED not configured" }, { status: 500 });
  if (!DOMAIN_ID)      return NextResponse.json({ error: "PERMISSIONED_DOMAIN_ID not configured" }, { status: 500 });
  if (!credentialType) return NextResponse.json({ error: "NEXT_PUBLIC_CREDENTIAL_TYPE not configured" }, { status: 500 });

  const client = new Client(NETWORK);
  try {
    await client.connect();
    const issuerWallet = Wallet.fromSeed(issuerSeed);

    const tx = {
      TransactionType:     "PermissionedDomainSet",
      Account:             issuerWallet.address,
      DomainID:            DOMAIN_ID,
      AcceptedCredentials: [
        {
          Credential: {
            Issuer:         issuerAddress ?? issuerWallet.address,
            CredentialType: credentialType,
          },
        },
      ],
    };

    const result   = await client.submitAndWait(tx, { autofill: true, wallet: issuerWallet });
    const txResult = result.result.meta?.TransactionResult;

    if (txResult !== "tesSUCCESS") {
      throw new Error(`PermissionedDomainSet failed: ${txResult}`);
    }

    return NextResponse.json({
      ok:             true,
      hash:           result.result.hash,
      domainId:       DOMAIN_ID,
      credentialType,
    });
  } catch (err) {
    console.error("[update-domain]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    await client.disconnect();
  }
}
