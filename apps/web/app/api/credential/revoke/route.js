import { Client, Wallet } from "xrpl";
import { NextResponse } from "next/server";

const NETWORK = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";

// POST /api/credential/revoke
// Body: { subjectAddress: "r..." }
// Revokes (CredentialDelete) every credential the platform issuer has issued to subjectAddress.
export async function POST(request) {
  const { subjectAddress } = await request.json().catch(() => ({}));

  if (!subjectAddress) {
    return NextResponse.json({ error: "subjectAddress is required" }, { status: 400 });
  }

  const issuerSeed = process.env.PLATFORM_ISSUER_WALLET_SEED;
  if (!issuerSeed) {
    return NextResponse.json({ error: "PLATFORM_ISSUER_WALLET_SEED not configured" }, { status: 500 });
  }

  const client = new Client(NETWORK);

  try {
    await client.connect();
    const issuerWallet = Wallet.fromSeed(issuerSeed);

    // Fetch all credentials held by subjectAddress
    let objects = [];
    try {
      const res = await client.request({
        command:      "account_objects",
        account:      subjectAddress,
        type:         "credential",
        ledger_index: "validated",
      });
      objects = res.result.account_objects ?? [];
    } catch (err) {
      if (err?.data?.error === "actNotFound" || err?.message?.includes("actNotFound")) {
        return NextResponse.json({ revoked: [], message: "Account not found on ledger — nothing to revoke." });
      }
      throw err;
    }

    // Keep only credentials issued by this platform issuer
    const ours = objects.filter(c => c.Issuer === issuerWallet.address);

    if (ours.length === 0) {
      return NextResponse.json({ revoked: [], message: "No platform credentials found for this address." });
    }

    // Revoke each one with CredentialDelete (issued from the issuer's account)
    const results = [];
    for (const cred of ours) {
      try {
        const tx = {
          TransactionType: "CredentialDelete",
          Account:         issuerWallet.address,
          Subject:         subjectAddress,
          CredentialType:  cred.CredentialType,
        };
        const result   = await client.submitAndWait(tx, { autofill: true, wallet: issuerWallet });
        const txResult = result.result.meta?.TransactionResult;
        results.push({
          credentialType: cred.CredentialType,
          txHash:         result.result.hash,
          status:         txResult,
          ok:             txResult === "tesSUCCESS",
        });
      } catch (err) {
        results.push({
          credentialType: cred.CredentialType,
          error:          err.message,
          ok:             false,
        });
      }
    }

    const allOk = results.every(r => r.ok);
    console.log(`[credential/revoke] Revoked ${results.filter(r => r.ok).length}/${results.length} credentials for ${subjectAddress}`);

    return NextResponse.json({ revoked: results, allOk });
  } catch (err) {
    console.error("[credential/revoke]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    await client.disconnect();
  }
}
