import { NextResponse } from "next/server"
import { Client, Wallet } from "xrpl"

const NETWORK      = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233"
const RIPPLE_EPOCH = 946684800
const ORACLE_DOC_ID = parseInt(process.env.ORACLE_DOCUMENT_ID ?? "1", 10)

const textToHex = (s) => Buffer.from(s, "utf8").toString("hex").toUpperCase()

async function getLedgerTime(client) {
  const res = await client.request({ command: "ledger", ledger_index: "closed" })
  const t   = res.result.ledger.close_time
  return t ? t + RIPPLE_EPOCH : Math.floor(Date.now() / 1000)
}

async function ensureFunded(client, wallet) {
  try {
    await client.request({ command: "account_info", account: wallet.address, ledger_index: "validated" })
  } catch (err) {
    if (err?.data?.error === "actNotFound" || err?.message?.includes("actNotFound")) {
      await client.fundWallet(wallet)
    } else throw err
  }
}

async function fetchLiveXrpPrice() {
  try {
    const res   = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=XRPUSDT")
    const data  = await res.json()
    const price = parseFloat(data.price)
    if (!price || isNaN(price)) throw new Error("invalid")
    return price
  } catch {
    const res   = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ripple&vs_currencies=usd")
    const data  = await res.json()
    const price = data?.ripple?.usd
    if (!price || isNaN(price)) throw new Error("Cannot fetch XRP/USD")
    return price
  }
}

async function fetchLiveGoldPrice() {
  try {
    const res   = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=pax-gold&vs_currencies=usd")
    const data  = await res.json()
    const price = parseFloat(data?.["pax-gold"]?.usd)
    if (!price || isNaN(price)) throw new Error("invalid")
    return price
  } catch {
    const res   = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d", {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    const data  = await res.json()
    const price = parseFloat(data?.chart?.result?.[0]?.meta?.regularMarketPrice)
    if (!price || isNaN(price)) throw new Error("Cannot fetch XAU/USD")
    return price
  }
}

// ── GET — read current oracle state from XRPL ─────────────────────────────────

export async function GET() {
  const oracleAccount = process.env.NEXT_PUBLIC_ORACLE_ACCOUNT
  const docId         = ORACLE_DOC_ID

  if (!oracleAccount) {
    return NextResponse.json({ configured: false, message: "NEXT_PUBLIC_ORACLE_ACCOUNT not set" })
  }

  const client = new Client(NETWORK)
  try {
    await client.connect()

    let xrpUsd = null
    let xauUsd = null
    let lastUpdateTime = null

    try {
      const r1 = await client.request({
        command:      "get_aggregate_price",
        ledger_index: "current",
        base_asset:   "XRP",
        quote_asset:  "USD",
        oracles:      [{ account: oracleAccount, oracle_document_id: docId }],
      })
      xrpUsd = parseFloat(r1.result.entire_set?.mean)
    } catch {}

    try {
      const r2 = await client.request({
        command:      "get_aggregate_price",
        ledger_index: "current",
        base_asset:   "XAU",
        quote_asset:  "USD",
        oracles:      [{ account: oracleAccount, oracle_document_id: docId }],
      })
      xauUsd = parseFloat(r2.result.entire_set?.mean)
    } catch {}

    try {
      const obj = await client.request({
        command: "ledger_entry",
        oracle:  { account: oracleAccount, oracle_document_id: docId },
      })
      lastUpdateTime = obj.result.node?.LastUpdateTime
    } catch {}

    return NextResponse.json({
      configured: true,
      account: oracleAccount,
      docId,
      xrpUsd,
      xauUsd,
      lastUpdateTime,
      network: NETWORK,
    })
  } catch (err) {
    return NextResponse.json({ configured: false, error: err.message }, { status: 500 })
  } finally {
    await client.disconnect()
  }
}

// ── POST — setup oracle or push price ─────────────────────────────────────────

export async function POST(request) {
  const body = await request.json()

  if (body.action === "setup")  return handleSetup()
  if (body.action === "push")   return handlePush(body)
  if (body.action === "status") {
    // live market prices only — no XRPL call
    try {
      const [xrpUsd, xauUsd] = await Promise.all([fetchLiveXrpPrice(), fetchLiveGoldPrice()])
      return NextResponse.json({ ok: true, xrpUsd, xauUsd })
    } catch (err) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}

async function handleSetup() {
  const SCALE = 6
  const existingSeed = process.env.ORACLE_WALLET_SEED
  const oracle       = existingSeed ? Wallet.fromSeed(existingSeed) : Wallet.generate()
  const seed         = existingSeed ?? oracle.seed

  const client = new Client(NETWORK)
  try {
    await client.connect()
    await ensureFunded(client, oracle)

    const [xrpPrice, xauPrice] = await Promise.all([fetchLiveXrpPrice(), fetchLiveGoldPrice()])
    const ledgerTime = await getLedgerTime(client)

    const tx = {
      TransactionType:  "OracleSet",
      Account:          oracle.address,
      OracleDocumentID: ORACLE_DOC_ID,
      Provider:         textToHex("flowpay"),
      AssetClass:       textToHex("currency"),
      LastUpdateTime:   ledgerTime,
      PriceDataSeries: [
        { PriceData: { BaseAsset: "XRP", QuoteAsset: "USD", AssetPrice: Math.round(xrpPrice * Math.pow(10, SCALE)), Scale: SCALE } },
        { PriceData: { BaseAsset: "XAU", QuoteAsset: "USD", AssetPrice: Math.round(xauPrice * Math.pow(10, SCALE)), Scale: SCALE } },
      ],
    }

    const res    = await client.submitAndWait(tx, { autofill: true, wallet: oracle })
    const result = res.result.meta.TransactionResult
    if (result !== "tesSUCCESS") throw new Error(result)

    return NextResponse.json({
      ok: true,
      account: oracle.address,
      seed,
      docId: ORACLE_DOC_ID,
      xrpPrice,
      xauPrice,
      hash: res.result.hash,
    })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  } finally {
    await client.disconnect()
  }
}

async function handlePush({ mode = "manual", price, scale = 6 }) {
  const seed = process.env.ORACLE_WALLET_SEED
  if (!seed) return NextResponse.json({ ok: false, error: "ORACLE_WALLET_SEED not set — run Setup first" }, { status: 400 })

  if (mode === "stale") {
    return NextResponse.json({ ok: true, mode: "stale", message: "No transaction submitted (oracle silent)" })
  }

  let finalPrice
  if (mode === "crash") {
    finalPrice = (await fetchLiveXrpPrice()) * 0.01
  } else if (mode === "pump") {
    finalPrice = (await fetchLiveXrpPrice()) * 10
  } else if (mode === "live") {
    finalPrice = await fetchLiveXrpPrice()
  } else {
    if (!price || isNaN(parseFloat(price))) {
      return NextResponse.json({ ok: false, error: "Missing or invalid price for manual mode" }, { status: 400 })
    }
    finalPrice = parseFloat(price)
  }

  const oracle = Wallet.fromSeed(seed)
  const client = new Client(NETWORK)
  try {
    await client.connect()
    const ledgerTime = await getLedgerTime(client)

    const tx = {
      TransactionType:  "OracleSet",
      Account:          oracle.address,
      OracleDocumentID: ORACLE_DOC_ID,
      Provider:         textToHex("flowpay"),
      AssetClass:       textToHex("currency"),
      LastUpdateTime:   ledgerTime,
      PriceDataSeries: [{
        PriceData: { BaseAsset: "XRP", QuoteAsset: "USD", AssetPrice: Math.round(finalPrice * Math.pow(10, scale)), Scale: scale },
      }],
    }

    const res    = await client.submitAndWait(tx, { autofill: true, wallet: oracle })
    const result = res.result.meta.TransactionResult
    if (result !== "tesSUCCESS") throw new Error(result)

    return NextResponse.json({ ok: true, mode, price: finalPrice, scale, hash: res.result.hash })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  } finally {
    await client.disconnect()
  }
}
