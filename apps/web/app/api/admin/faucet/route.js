import { NextResponse } from "next/server"

const FAUCET_PORT = process.env.FAUCET_PORT ?? "7007"
const FAUCET_URL  = `http://localhost:${FAUCET_PORT}`

// ── POST { action: "fund", destination? } ─────────────────────────────────────
export async function POST(request) {
  const { action, destination } = await request.json()

  if (action === "fund") {
    try {
      const body = destination ? JSON.stringify({ destination }) : "{}"
      const res  = await fetch(`${FAUCET_URL}/accounts`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body,
      })
      const data = await res.json()
      if (!res.ok) return NextResponse.json({ ok: false, error: data.error }, { status: res.status })
      return NextResponse.json({ ok: true, ...data })
    } catch (err) {
      return NextResponse.json({ ok: false, error: `Faucet unreachable — is it running? (${err.message})` }, { status: 503 })
    }
  }

  if (action === "ledger-accept") {
    try {
      const res  = await fetch(`${FAUCET_URL}/ledger-accept`, { method: "POST" })
      const data = await res.json()
      return NextResponse.json({ ok: true, ...data })
    } catch (err) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 503 })
    }
  }

  if (action === "health") {
    try {
      const res  = await fetch(`${FAUCET_URL}/health`)
      const data = await res.json()
      return NextResponse.json({ ok: true, ...data })
    } catch (err) {
      return NextResponse.json({ ok: false, error: `Faucet unreachable (${err.message})` }, { status: 503 })
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}
