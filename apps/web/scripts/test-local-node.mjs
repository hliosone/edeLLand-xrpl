/**
 * test-local-node.mjs — Smoke test for local rippled standalone node
 *
 * Run : node scripts/test-local-node.mjs
 */

import pkg from "xrpl"
const { Client, Wallet, ECDSA } = pkg

const RIPPLED_WS   = process.env.XRPL_LOCAL_ENDPOINT ?? "ws://localhost:6006"
const RIPPLED_HTTP = process.env.RIPPLED_HTTP_URL     ?? "http://localhost:5005"

const GENESIS_SEED    = "snoPBrXtMeMyMHUVTgbuqAfg1SUTb"
const GENESIS_ADDRESS = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"

const FUND_XRP    = 10_000
const FUND_DROPS  = String(FUND_XRP * 1_000_000)
const SEND_XRP    = 42
const SEND_DROPS  = String(SEND_XRP * 1_000_000)

async function rpc(method, params = {}) {
  const res  = await fetch(RIPPLED_HTTP, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ method, params: [params] }),
  })
  const data = await res.json()
  if (data.result?.error) throw new Error(`${method}: ${data.result.error_message ?? data.result.error}`)
  return data.result
}

function dropsToXrp(drops) {
  return (Number(drops) / 1_000_000).toFixed(6)
}

async function getBalance(address) {
  try {
    const res = await rpc("account_info", { account: address, ledger_index: "validated" })
    return res.account_data.Balance
  } catch {
    return "0"
  }
}

async function submitAndAccept(wallet, txBase) {
  const seqRes  = await rpc("account_info", { account: txBase.Account, ledger_index: "current" })
  const sequence = seqRes.account_data.Sequence
  const ledgerRes = await rpc("ledger_current", {})
  const currentLedger = ledgerRes.ledger_current_index

  const networkInfo = await rpc("server_info", {})
  const networkId   = networkInfo.info?.network_id ?? 0

  const tx = {
    ...txBase,
    NetworkID:          networkId,
    Fee:                "12",
    Sequence:           sequence,
    LastLedgerSequence: currentLedger + 20,
  }

  const signed = wallet.sign(tx)
  const submit = await rpc("submit", { tx_blob: signed.tx_blob })

  if (!submit.engine_result?.startsWith("tes")) {
    throw new Error(`Submit failed: ${submit.engine_result} — ${submit.engine_result_message}`)
  }

  await rpc("ledger_accept", {})
  return { hash: signed.hash, engine_result: submit.engine_result }
}

function step(n, label) {
  console.log(`\n[${n}] ${label}`)
  console.log("─".repeat(50))
}

async function main() {
  console.log("═".repeat(50))
  console.log("  XRPL Local Node — Smoke Test")
  console.log(`  WS  : ${RIPPLED_WS}`)
  console.log(`  RPC : ${RIPPLED_HTTP}`)
  console.log("═".repeat(50))

  step(1, "Vérification du nœud (server_info)")

  const info = await rpc("server_info", {})
  const state  = info.info?.server_state
  const ledger = info.info?.validated_ledger?.seq
  console.log(`  server_state : ${state}`)
  console.log(`  ledger seq   : ${ledger}`)

  if (state !== "full") {
    console.error(`  ✖ server_state="${state}" — attendu "full". Le nœud n'est pas prêt.`)
    process.exit(1)
  }
  console.log("  ✔ Nœud opérationnel")

  step(2, "Connexion xrpl.js")

  const client = new Client(RIPPLED_WS)
  await client.connect()
  console.log(`  ✔ Connecté à ${RIPPLED_WS}`)

  try {
    const genesis = Wallet.fromSeed(GENESIS_SEED, { algorithm: ECDSA.secp256k1 })
    const target  = Wallet.generate()

    console.log(`\n  Genesis  : ${GENESIS_ADDRESS}`)
    console.log(`  Target   : ${target.address}  (seed: ${target.seed})`)

    step(3, `Funding target wallet (${FUND_XRP} XRP depuis genesis)`)

    const balGenesisBefore = await getBalance(GENESIS_ADDRESS)
    console.log(`  Genesis avant : ${dropsToXrp(balGenesisBefore)} XRP`)

    const fundResult = await submitAndAccept(genesis, {
      TransactionType: "Payment",
      Account:         GENESIS_ADDRESS,
      Destination:     target.address,
      Amount:          FUND_DROPS,
    })

    console.log(`  ✔ tx : ${fundResult.hash}  (${fundResult.engine_result})`)

    const balTarget = await getBalance(target.address)
    console.log(`  Target après  : ${dropsToXrp(balTarget)} XRP`)

    if (balTarget === "0") throw new Error("Target non activé après funding")

    step(4, `Payment target → genesis (${SEND_XRP} XRP)`)

    const balGenesisBefore2 = await getBalance(GENESIS_ADDRESS)
    console.log(`  Genesis avant : ${dropsToXrp(balGenesisBefore2)} XRP`)
    console.log(`  Target avant  : ${dropsToXrp(await getBalance(target.address))} XRP`)

    const payResult = await submitAndAccept(target, {
      TransactionType: "Payment",
      Account:         target.address,
      Destination:     GENESIS_ADDRESS,
      Amount:          SEND_DROPS,
    })

    console.log(`  ✔ tx : ${payResult.hash}  (${payResult.engine_result})`)

    const balGenesisAfter = await getBalance(GENESIS_ADDRESS)
    const balTargetAfter  = await getBalance(target.address)
    console.log(`  Genesis après : ${dropsToXrp(balGenesisAfter)} XRP`)
    console.log(`  Target après  : ${dropsToXrp(balTargetAfter)} XRP`)

    console.log("\n" + "═".repeat(50))
    console.log("  ✔ Tous les tests passés — nœud local opérationnel")
    console.log("═".repeat(50) + "\n")
  } finally {
    await client.disconnect()
  }
}

main().catch(err => {
  console.error("\n✖ Erreur :", err.message)
  process.exit(1)
})
