import { Client, Wallet } from "xrpl";
import { NextResponse } from "next/server";

const RLUSD_CURRENCY = "524C555344000000000000000000000000000000";
const RLUSD_AMOUNT   = "5000";

export async function POST(request) {
  const { destination } = await request.json();

  if (!destination) {
    return NextResponse.json({ error: "destination required" }, { status: 400 });
  }

  const issuerSeed    = process.env.RLUSD_ISSUER_WALLET_SEED;
  const issuerAddress = process.env.RLUSD_ISSUER_WALLET_ADDRESS;
  const network       = process.env.XRPL_NETWORK_ENDPOINT || "wss://s.devnet.rippletest.net:51233";

  if (!issuerSeed) {
    return NextResponse.json({ error: "RLUSD_ISSUER_WALLET_SEED not configured" }, { status: 500 });
  }

  const client = new Client(network);
  try {
    await client.connect();
    const issuerWallet = Wallet.fromSeed(issuerSeed);

    const tx = {
      TransactionType: "Payment",
      Account:         issuerWallet.address,
      Destination:     destination,
      Amount: {
        currency: RLUSD_CURRENCY,
        issuer:   issuerWallet.address,
        value:    RLUSD_AMOUNT,
      },
    };

    const result   = await client.submitAndWait(tx, { autofill: true, wallet: issuerWallet });
    const txResult = result.result.meta?.TransactionResult;

    if (txResult !== "tesSUCCESS") {
      throw new Error(`Payment failed: ${txResult}`);
    }

    return NextResponse.json({
      ok:          true,
      hash:        result.result.hash,
      destination,
      amount:      RLUSD_AMOUNT,
      issuer:      issuerAddress ?? issuerWallet.address,
    });
  } catch (err) {
    console.error("[rlusd-faucet]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    await client.disconnect();
  }
}
