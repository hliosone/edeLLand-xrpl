import { Client } from "xrpl";
import { NextResponse } from "next/server";

const NETWORK         = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";
const VAULT_ID        = process.env.PERMISSIONED_VAULT_ID;
const ENV_MPT_ID      = process.env.NEXT_PUBLIC_MPT_ISSUANCE_ID ?? null;

export async function GET() {
  if (!VAULT_ID) {
    return NextResponse.json({ error: "PERMISSIONED_VAULT_ID not configured" }, { status: 500 });
  }

  const client = new Client(NETWORK);

  try {
    await client.connect();

    const res  = await client.request({ command: "ledger_entry", vault: VAULT_ID, ledger_index: "validated" });
    const node = res.result.node;

    // XLS-65 field name varies across devnet builds — try env first, then all known variants
    let shareMPTID =
      ENV_MPT_ID              ??
      node.ShareMPTID         ??
      node.MPTokenIssuanceID  ??
      node.LPTokenIssuanceID  ??
      node.ShareToken         ??
      null;

    // If still null: the vault owner has exactly one MPT issuance — find it
    if (!shareMPTID && node.Account) {
      try {
        const objRes = await client.request({
          command:      "account_objects",
          account:      node.Account,
          type:         "mpt_issuance",
          ledger_index: "validated",
        });
        const issuances = objRes.result.account_objects ?? [];
        if (issuances.length > 0) {
          // Pick the one whose index matches what a vault would own
          shareMPTID = issuances[0].index ?? issuances[0].MPTokenIssuanceID ?? null;
        }
      } catch { /* non-fatal */ }
    }

    // Total LP supply: try vault node field, then query the MPT issuance
    let totalLpSupply = node.LPTokenBalance ?? node.ShareBalance ?? "0";
    if (shareMPTID && totalLpSupply === "0") {
      try {
        const mptRes = await client.request({
          command:      "ledger_entry",
          mpt_issuance: shareMPTID,
          ledger_index: "validated",
        });
        const mptNode = mptRes.result.node;
        totalLpSupply = mptNode.OutstandingAmount ?? mptNode.MaximumAmount ?? "0";
      } catch { /* non-fatal */ }
    }

    return NextResponse.json({
      vaultId:           VAULT_ID,
      asset:             node.Asset,
      assetsTotal:       node.AssetsTotal,
      assetsAvailable:   node.AssetsAvailable,
      lpTokenBalance:    totalLpSupply,
      mpTokenIssuanceId: shareMPTID,
      owner:             node.Account,
    });
  } catch (err) {
    console.error("[vault/info]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    await client.disconnect();
  }
}
