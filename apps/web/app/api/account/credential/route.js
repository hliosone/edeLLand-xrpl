import { Client } from "xrpl"
import { NextResponse } from "next/server"

const NETWORK = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233"

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const address = searchParams.get("address")

  if (!address) return NextResponse.json({ error: "address required" }, { status: 400 })

  const platformIssuer = process.env.PLATFORM_ISSUER_WALLET_ADDRESS
  const client = new Client(NETWORK)

  try {
    await client.connect()

    const res = await client.request({
      command:      "account_objects",
      account:      address,
      type:         "credential",
      ledger_index: "validated",
    })

    const objects = res.result.account_objects ?? []

    // Filter by platform issuer if configured
    const filtered = platformIssuer
      ? objects.filter(c => c.Issuer === platformIssuer)
      : objects

    const credentials = filtered.map(c => ({
      issuer:               c.Issuer,
      subject:              c.Subject,
      credentialType:       c.CredentialType,
      credentialTypeLabel:  hexToUtf8(c.CredentialType),
      accepted:             !!(c.Flags & 0x00010000),
    }))

    return NextResponse.json({ credentials })
  } catch (err) {
    // account not found on ledger = no credentials
    if (err?.data?.error === "actNotFound" || err?.message?.includes("actNotFound")) {
      return NextResponse.json({ credentials: [] })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  } finally {
    await client.disconnect()
  }
}

function hexToUtf8(hex) {
  try {
    return Buffer.from(hex, "hex").toString("utf8").replace(/\0/g, "").trim()
  } catch {
    return hex
  }
}
