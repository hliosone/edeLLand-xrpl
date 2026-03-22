import { Client, convertStringToHex } from "xrpl";
import { writeEnvVars } from "./env-writer.mjs";

// XRPL Price Oracle (XLS-47d)
// OracleDocumentID — arbitrary uint32, unique per provider account
const ORACLE_DOCUMENT_ID = 1;

// AssetClass "currency" as hex
const ASSET_CLASS = convertStringToHex("currency");

// Provider name as hex
const PROVIDER = convertStringToHex("edeLLand");

// Devnet price seeds (XRP/USD ~2.50, XRP/CHF ~2.20).
// Scale=2 means AssetPrice represents value * 10^-2.
// Each entry must be wrapped in { PriceData: { ... } } per XLS-47d spec.
const PRICE_DATA_SERIES = [
  { PriceData: { BaseAsset: "XRP", QuoteAsset: "USD", AssetPrice: 250, Scale: 2 } },
  { PriceData: { BaseAsset: "XRP", QuoteAsset: "CHF", AssetPrice: 220, Scale: 2 } },
];

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
 * Creates an on-chain Price Oracle for XRP/USD and XRP/CHF pairs.
 *
 * Steps:
 *   1. Submit OracleSet with ORACLE_ADMIN_WALLET
 *   2. Write NEXT_PUBLIC_ORACLE_ADDRESS + NEXT_PUBLIC_ORACLE_DOCUMENT_ID to .env.local
 *
 * @param {object} ctx - must contain ORACLE_ADMIN_WALLET (set by createAccounts)
 */
export async function setupOracle(ctx) {
  const oracleAdmin = ctx.ORACLE_ADMIN_WALLET;

  if (!oracleAdmin) {
    throw new Error("ctx is missing ORACLE_ADMIN_WALLET — run createAccounts first");
  }

  console.log(`\n[setup-oracle] Oracle admin : ${oracleAdmin.address}`);
  console.log(`[setup-oracle] Pairs        : ${PRICE_DATA_SERIES.map(p => `${p.BaseAsset}/${p.QuoteAsset}`).join(", ")}`);

  const client = new Client(process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233");
  await client.connect();

  // LastUpdateTime is a Unix timestamp (seconds since 1970-01-01 UTC)
  const lastUpdateTime = Math.floor(Date.now() / 1000);

  await submit(client, {
    TransactionType:  "OracleSet",
    Account:          oracleAdmin.address,
    OracleDocumentID: ORACLE_DOCUMENT_ID,
    Provider:         PROVIDER,
    AssetClass:       ASSET_CLASS,
    LastUpdateTime:   lastUpdateTime,
    PriceDataSeries:  PRICE_DATA_SERIES,
  }, oracleAdmin, `OracleSet — ${PRICE_DATA_SERIES.map(p => `${p.BaseAsset}/${p.QuoteAsset}`).join(", ")}`);

  writeEnvVars({
    NEXT_PUBLIC_ORACLE_ADDRESS:     oracleAdmin.address,
    NEXT_PUBLIC_ORACLE_DOCUMENT_ID: String(ORACLE_DOCUMENT_ID),
  });

  await client.disconnect();
}
