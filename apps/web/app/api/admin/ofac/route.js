import { NextResponse } from "next/server";
import { isBlocked, addAddress, removeAddress, getList, getLog } from "../../../../lib/ofac";

// GET /api/admin/ofac  →  { list, log }
export function GET(request) {
  const { searchParams } = new URL(request.url);
  const logLimit = parseInt(searchParams.get("logLimit") ?? "100", 10);
  return NextResponse.json({ list: getList(), log: getLog(logLimit) });
}

// POST /api/admin/ofac  →  { action: "add"|"remove"|"check", ... }
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const { action, address } = body;

  if (!action) return NextResponse.json({ error: "action is required" }, { status: 400 });
  if (!address) return NextResponse.json({ error: "address is required" }, { status: 400 });

  try {
    if (action === "check") {
      const result = isBlocked(address, { action: "MANUAL_CHECK", logClean: true });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "add") {
      const { label, source } = body;
      const entry = addAddress({ address, label, source, addedBy: "admin" });
      return NextResponse.json({ ok: true, entry, list: getList(), log: getLog() });
    }

    if (action === "remove") {
      const removed = removeAddress(address, { removedBy: "admin" });
      return NextResponse.json({ ok: true, removed, list: getList(), log: getLog() });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
  }
}
