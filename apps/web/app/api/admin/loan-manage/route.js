import { NextResponse } from "next/server";
import { Client, Wallet } from "xrpl";

// POST /api/admin/loan-manage
// Body: { action: "default" | "impair" | "unimpair" | "delete", loanId: string }
// All transactions are signed by the platform broker wallet (LoanBroker.Owner).

const ACTION_FLAGS = {
  default:  0x00010000, // tfLoanDefault
  impair:   0x00020000, // tfLoanImpair
  unimpair: 0x00040000, // tfLoanUnimpair
};

export async function POST(request) {
  try {
    const { action, loanId } = await request.json();

    if (!loanId) {
      return NextResponse.json({ error: "loanId required" }, { status: 400 });
    }
    if (!["default", "impair", "unimpair", "delete"].includes(action)) {
      return NextResponse.json({ error: "invalid action" }, { status: 400 });
    }

    const brokerSeed = process.env.PLATFORM_BROKER_WALLET_SEED;
    const endpoint   = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";

    if (!brokerSeed) {
      return NextResponse.json(
        { error: "PLATFORM_BROKER_WALLET_SEED not configured" },
        { status: 500 }
      );
    }

    const broker = Wallet.fromSeed(brokerSeed);
    const client = new Client(endpoint);
    await client.connect();

    try {
      let tx;

      if (action === "delete") {
        tx = {
          TransactionType: "LoanDelete",
          Account:         broker.address,
          LoanID:          loanId,
        };
      } else {
        tx = {
          TransactionType: "LoanManage",
          Account:         broker.address,
          LoanID:          loanId,
          Flags:           ACTION_FLAGS[action],
        };
      }

      const prepared = await client.autofill(tx);
      const signed   = broker.sign(prepared);
      const result   = await client.submitAndWait(signed.tx_blob);

      const txResult = result.result.meta?.TransactionResult;
      if (txResult !== "tesSUCCESS") {
        return NextResponse.json(
          { error: `Transaction failed: ${txResult}` },
          { status: 400 }
        );
      }

      return NextResponse.json({
        ok:     true,
        action,
        loanId,
        hash:   result.result.hash,
        txResult,
      });
    } finally {
      await client.disconnect();
    }
  } catch (err) {
    console.error("[admin/loan-manage]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
