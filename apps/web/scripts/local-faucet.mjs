/**
 * local-faucet.mjs — Faucet HTTP server for local rippled standalone node
 *
 * Mimics the Ripple devnet faucet API so xrpl.js fundWallet() works out-of-the-box.
 * Uses the genesis wallet to fund accounts via Payment transactions,
 * then calls ledger_accept to close the ledger.
 *
 * Endpoint : POST /accounts
 *   Body (optional) : { "destination": "r..." }
 *   Response        : { account: { classicAddress, secret, xAddress }, amount }
 *
 * Run  : node scripts/local-faucet.mjs
 * Port : 7007 (set FAUCET_PORT env var to override)
 */

import http from "http"
import pkg from "xrpl"
const { Client, Wallet, ECDSA } = pkg

// ── Config ────────────────────────────────────────────────────────────────────

const PORT         = parseInt(process.env.FAUCET_PORT   ?? "7007", 10)
const RIPPLED_RPC  = process.env.RIPPLED_HTTP_URL       ?? "http://localhost:5005"
const RIPPLED_WSS  = process.env.XRPL_NETWORK_ENDPOINT ?? "ws://localhost:6006"

// Genesis account — standard standalone seed (public knowledge)
const GENESIS_SEED    = "snoPBrXtMeMyMHUVTgbuqAfg1SUTb"
const GENESIS_ADDRESS = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"
const FUND_AMOUNT_XRP = 10_000
const FUND_DROPS      = String(FUND_AMOUNT_XRP * 1_000_000)

let NETWORK_ID = undefined

// ── XRPL helpers ──────────────────────────────────────────────────────────────

async function rpc(method, params = {}) {
  const res  = await fetch(RIPPLED_RPC, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ method, params: [params] }),
  })
  const data = await res.json()
  if (data.result?.error) throw new Error(`rippled ${method}: ${data.result.error_message ?? data.result.error}`)
  return data.result
}

async function ledgerAccept() {
  return rpc("ledger_accept", {})
}

async function getSequence(address) {
  const res = await rpc("account_info", { account: address, ledger_index: "current" })
  return res.account_data.Sequence
}

async function fundAccount(destination) {
  const genesis  = Wallet.fromSeed(GENESIS_SEED, { algorithm: ECDSA.secp256k1 })
  const sequence = await getSequence(GENESIS_ADDRESS)
  const ledgerRes = await rpc("ledger_current", {})
  const currentLedger = ledgerRes.ledger_current_index

  const tx = {
    TransactionType: "Payment",
    Account:         GENESIS_ADDRESS,
    Destination:     destination,
    Amount:          FUND_DROPS,
    Fee:             "12",
    Sequence:        sequence,
    LastLedgerSequence: currentLedger + 20,
    ...(NETWORK_ID != null ? { NetworkID: NETWORK_ID } : {}),
  }

  const signed = genesis.sign(tx)
  const submit = await rpc("submit", { tx_blob: signed.tx_blob })
  const engineResult = submit.engine_result
  if (!engineResult?.startsWith("tes") && engineResult !== "tesSUCCESS") {
    throw new Error(`Submit failed: ${engineResult} — ${submit.engine_result_message}`)
  }

  await ledgerAccept()

  return FUND_AMOUNT_XRP
}

// ── HTTP server ───────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve) => {
    let data = ""
    req.on("data", chunk => { data += chunk })
    req.on("end",  () => {
      try { resolve(data ? JSON.parse(data) : {}) }
      catch { resolve({}) }
    })
  })
}

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" })
  res.end(body)
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" })
    res.end()
    return
  }

  const url = req.url?.split("?")[0]

  if (req.method === "POST" && url === "/accounts") {
    const body        = await readBody(req)
    let   destination = body.destination ?? body.account

    let newWallet = null
    if (!destination) {
      newWallet   = Wallet.generate()
      destination = newWallet.address
    }

    console.log(`  → Funding ${destination}…`)
    try {
      const amount = await fundAccount(destination)
      console.log(`  ✔ ${destination} +${amount} XRP`)
      json(res, 200, {
        account: {
          classicAddress: destination,
          xAddress:       destination,
          secret:         newWallet?.seed ?? null,
        },
        amount,
      })
    } catch (err) {
      console.error(`  ✖ ${err.message}`)
      json(res, 500, { error: err.message })
    }
    return
  }

  if (req.method === "GET" && url === "/health") {
    try {
      const info = await rpc("server_info", {})
      json(res, 200, { ok: true, server_state: info.info?.server_state, ledger: info.info?.validated_ledger?.seq })
    } catch (err) {
      json(res, 503, { ok: false, error: err.message })
    }
    return
  }

  if ((req.method === "POST" || req.method === "GET") && url === "/ledger-accept") {
    try {
      const r = await ledgerAccept()
      json(res, 200, { ok: true, ledger_current_index: r.ledger_current_index })
    } catch (err) {
      json(res, 500, { ok: false, error: err.message })
    }
    return
  }

  json(res, 404, { error: `No route: ${req.method} ${url}` })
})

server.listen(PORT, async () => {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  console.log(`  Local Faucet running on http://localhost:${PORT}`)
  console.log(`  rippled RPC  → ${RIPPLED_RPC}`)
  console.log(`  genesis      → ${GENESIS_ADDRESS}`)

  try {
    const info = await rpc("server_info", {})
    NETWORK_ID = info.info?.network_id
    if (NETWORK_ID != null) console.log(`  networkID    → ${NETWORK_ID}`)
  } catch {
    console.warn("  ⚠ Could not fetch NetworkID from rippled")
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  console.log("  POST /accounts          fund a wallet")
  console.log("  GET  /health            node state")
  console.log("  POST /ledger-accept     close ledger")
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
})

server.on("error", err => {
  console.error("Server error:", err.message)
  process.exit(1)
})
