"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { useWallet } from "../../components/providers/WalletProvider";

// ── Loan Management Tab ───────────────────────────────────────────────────────

const RIPPLE_EPOCH_ADMIN = 946684800;

function nowRippleAdmin() {
  return Math.floor(Date.now() / 1000) - RIPPLE_EPOCH_ADMIN;
}

function fmtDateAdmin(ts) {
  if (!ts) return "—";
  const d = new Date((ts + RIPPLE_EPOCH_ADMIN) * 1000);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function loanFlagsDefault(loan)  { return !!(loan.Flags & 0x00010000); }
function loanFlagsImpaired(loan) { return !!(loan.Flags & 0x00020000); }
function loanIsClosed(loan)      { return loan.PaymentRemaining === 0; }

function loanGraceExpiredAdmin(loan) {
  if (loanFlagsDefault(loan) || loanIsClosed(loan)) return false;
  const due   = loan.NextPaymentDueDate;
  const grace = loan.GracePeriod ?? 0;
  if (!due) return false;
  return nowRippleAdmin() > due + grace;
}

function loanStatusAdmin(loan) {
  if (loanFlagsDefault(loan))     return { label: "Defaulted",    color: "text-red-500",    variant: "destructive" };
  if (loanGraceExpiredAdmin(loan)) return { label: "Grace Expired", color: "text-red-500",    variant: "destructive" };
  if (loanIsClosed(loan))         return { label: "Closed",        color: "text-muted-foreground", variant: "secondary" };
  if (loanFlagsImpaired(loan))    return { label: "Impaired",      color: "text-amber-500",  variant: "warning" };
  return                                  { label: "Active",        color: "text-green-500",  variant: "success" };
}

function LoanManagementTab({ onLog }) {
  const pseudoAccount = process.env.NEXT_PUBLIC_PLATFORM_BROKER_WALLET_ADDRESS;

  const [loans,   setLoans]   = useState(undefined);
  const [loading, setLoading] = useState(false);
  const [acting,  setActing]  = useState({}); // loanId → true while in-flight

  const fetchLoans = useCallback(async () => {
    if (!pseudoAccount) return;
    setLoading(true);
    try {
      const res  = await fetch("/api/xrpl", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          method: "account_objects",
          params: { account: pseudoAccount, type: "loan", ledger_index: "validated" },
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setLoans(data.result?.account_objects ?? []);
    } catch (err) {
      onLog({ type: "error", text: `✖ ${err.message}` });
      setLoans([]);
    } finally {
      setLoading(false);
    }
  }, [pseudoAccount, onLog]);

  useEffect(() => { fetchLoans(); }, [fetchLoans]);

  async function act(action, loanId) {
    setActing(a => ({ ...a, [loanId]: action }));
    const labels = { default: "LoanManage(default)", impair: "LoanManage(impair)", unimpair: "LoanManage(unimpair)", delete: "LoanDelete" };
    onLog({ type: "info", text: `→ ${labels[action]} — ${shortHash(loanId)}` });
    try {
      const res  = await fetch("/api/admin/loan-manage", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action, loanId }),
      });
      const data = await res.json();
      if (data.ok) {
        onLog({ type: "success", text: `✔ ${labels[action]} ${shortHash(data.hash)}` });
        await fetchLoans();
      } else {
        onLog({ type: "error", text: `✖ ${data.error}` });
      }
    } catch (err) {
      onLog({ type: "error", text: `✖ ${err.message}` });
    } finally {
      setActing(a => { const n = { ...a }; delete n[loanId]; return n; });
    }
  }

  const graceExpiredCount = (loans ?? []).filter(l => loanGraceExpiredAdmin(l)).length;
  const activeCount       = (loans ?? []).filter(l => !loanFlagsDefault(l) && !loanIsClosed(l) && !loanGraceExpiredAdmin(l)).length;

  if (!pseudoAccount) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-destructive">
            <code>NEXT_PUBLIC_PLATFORM_BROKER_WALLET_ADDRESS</code> not set — cannot fetch loans.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total loans",    value: loans?.length ?? "—" },
          { label: "Grace Expired",  value: graceExpiredCount, danger: graceExpiredCount > 0 },
          { label: "Active",         value: activeCount },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold ${s.danger ? "text-red-500" : ""}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Loan list */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">All Loans</CardTitle>
            <Button variant="outline" size="sm" onClick={fetchLoans} disabled={loading}>
              {loading ? "…" : "Refresh"}
            </Button>
          </div>
          <CardDescription>
            Fetched from pseudo-account <code className="text-xs">{pseudoAccount}</code>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loans === undefined ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : loans.length === 0 ? (
            <p className="text-sm text-muted-foreground">No loans found.</p>
          ) : (
            <div className="space-y-3">
              {[...loans]
                .sort((a, b) => {
                  // Grace Expired first, then Defaulted, then rest
                  const priority = l =>
                    loanGraceExpiredAdmin(l) ? 0 :
                    loanFlagsDefault(l)      ? 1 :
                    loanFlagsImpaired(l)     ? 2 :
                    loanIsClosed(l)          ? 4 : 3;
                  return priority(a) - priority(b);
                })
                .map(loan => {
                  const loanId  = loan.index ?? loan.Index;
                  const status  = loanStatusAdmin(loan);
                  const busy    = !!acting[loanId];
                  const canDefault  = loanGraceExpiredAdmin(loan);
                  const canImpair   = !loanFlagsDefault(loan) && !loanIsClosed(loan) && !loanFlagsImpaired(loan) && !loanGraceExpiredAdmin(loan);
                  const canUnimpair = loanFlagsImpaired(loan) && !loanFlagsDefault(loan);
                  const canDelete   = loanIsClosed(loan) || (loanFlagsDefault(loan) && loan.PaymentRemaining === 0);

                  return (
                    <div
                      key={loanId}
                      className="rounded-lg border p-4 space-y-3"
                      style={canDefault ? { borderColor: "rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.04)" } : {}}
                    >
                      {/* Header row */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-0.5 min-w-0">
                          <code className="text-xs text-muted-foreground break-all">{loanId}</code>
                          <p className="text-xs text-muted-foreground">
                            Borrower: <code className="text-xs">{loan.Borrower}</code>
                          </p>
                        </div>
                        <Badge variant={status.variant} className="shrink-0">{status.label}</Badge>
                      </div>

                      {/* Figures */}
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <p className="text-muted-foreground">Outstanding</p>
                          <p className="font-semibold">{parseFloat(loan.TotalValueOutstanding ?? 0).toFixed(6)} RLUSD</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Principal left</p>
                          <p className="font-semibold">{parseFloat(loan.PrincipalOutstanding ?? 0).toFixed(6)} RLUSD</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Next due</p>
                          <p className="font-semibold">{fmtDateAdmin(loan.NextPaymentDueDate)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Payments left</p>
                          <p className="font-semibold">{loan.PaymentRemaining}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Grace period</p>
                          <p className="font-semibold">{loan.GracePeriod}s</p>
                        </div>
                      </div>

                      {/* Actions */}
                      {(canDefault || canImpair || canUnimpair || canDelete) && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {canDefault && (
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={busy}
                              onClick={() => act("default", loanId)}
                            >
                              {acting[loanId] === "default" ? "Processing…" : "Process Default"}
                            </Button>
                          )}
                          {canImpair && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => act("impair", loanId)}
                            >
                              {acting[loanId] === "impair" ? "…" : "Mark Impaired"}
                            </Button>
                          )}
                          {canUnimpair && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => act("unimpair", loanId)}
                            >
                              {acting[loanId] === "unimpair" ? "…" : "Unimpair"}
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-muted-foreground hover:text-destructive"
                              disabled={busy}
                              onClick={() => act("delete", loanId)}
                            >
                              {acting[loanId] === "delete" ? "Deleting…" : "Delete Loan"}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── AML / OFAC Tab ────────────────────────────────────────────────────────────

function OfacTab() {
  const [list,    setList]    = useState([]);
  const [log,     setLog]     = useState([]);
  const [loading, setLoading] = useState(false);

  // Add form
  const [addAddr,   setAddAddr]   = useState("");
  const [addLabel,  setAddLabel]  = useState("");
  const [addSource, setAddSource] = useState("MANUAL");

  // Check form
  const [checkAddr,   setCheckAddr]   = useState("");
  const [checkResult, setCheckResult] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch("/api/admin/ofac");
      const data = await res.json();
      setList(data.list ?? []);
      setLog(data.log ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleAdd() {
    if (!addAddr.trim()) return;
    const res  = await fetch("/api/admin/ofac", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ action: "add", address: addAddr.trim(), label: addLabel.trim(), source: addSource }),
    });
    const data = await res.json();
    if (data.ok) {
      setList(data.list);
      setLog(data.log);
      setAddAddr(""); setAddLabel(""); setAddSource("MANUAL");
    } else {
      alert(data.error);
    }
  }

  async function handleRemove(address) {
    const res  = await fetch("/api/admin/ofac", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ action: "remove", address }),
    });
    const data = await res.json();
    if (data.ok) { setList(data.list); setLog(data.log); }
    else alert(data.error);
  }

  async function handleCheck() {
    if (!checkAddr.trim()) return;
    const res  = await fetch("/api/admin/ofac", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ action: "check", address: checkAddr.trim() }),
    });
    const data = await res.json();
    setCheckResult(data);
    setLog(prev => {
      refresh();
      return prev;
    });
    refresh();
  }

  const SOURCE_COLORS = {
    OFAC:     "destructive",
    INTERNAL: "secondary",
    MANUAL:   "outline",
  };

  const LOG_COLORS = {
    BLOCK:  "text-red-500",
    ADD:    "text-amber-500",
    REMOVE: "text-blue-400",
    CHECK:  "text-muted-foreground",
  };

  return (
    <div className="space-y-6">

      {/* Sanctioned list */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Sanctions List</CardTitle>
              <CardDescription>OFAC SDN + internal AML flags</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
              {loading ? "…" : "Refresh"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">List is empty.</p>
          ) : (
            <div className="rounded-md border divide-y text-xs font-mono">
              {list.map(entry => (
                <div key={entry.address} className="flex items-center justify-between px-3 py-2 gap-3">
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="text-foreground truncate">{entry.address}</div>
                    <div className="text-muted-foreground truncate">{entry.label}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={SOURCE_COLORS[entry.source] ?? "outline"} className="text-xs">
                      {entry.source}
                    </Badge>
                    <span className="text-muted-foreground">{entry.addedAt}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive h-6 px-2"
                      onClick={() => handleRemove(entry.address)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add address */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add Address</CardTitle>
          <CardDescription>Manually flag an XRPL address</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>XRPL Address</Label>
            <Input placeholder="rXXX…" value={addAddr} onChange={e => setAddAddr(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Label</Label>
            <Input placeholder="Description / reason" value={addLabel} onChange={e => setAddLabel(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Source</Label>
            <div className="flex gap-2">
              {["MANUAL", "OFAC", "INTERNAL"].map(s => (
                <button
                  key={s}
                  onClick={() => setAddSource(s)}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                    addSource === s ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={handleAdd} disabled={!addAddr.trim()} className="w-full">
            Add to Sanctions List
          </Button>
        </CardFooter>
      </Card>

      {/* Check address */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Check Address</CardTitle>
          <CardDescription>Run a manual AML screening check</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="rXXX…"
              value={checkAddr}
              onChange={e => { setCheckAddr(e.target.value); setCheckResult(null); }}
              className="flex-1"
            />
            <Button onClick={handleCheck} disabled={!checkAddr.trim()}>Check</Button>
          </div>
          {checkResult && (
            checkResult.blocked ? (
              <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3 text-xs space-y-1">
                <div className="font-semibold text-red-500">BLOCKED — address is sanctioned</div>
                <div className="text-muted-foreground">{checkResult.label}</div>
                <div className="text-muted-foreground">Source: {checkResult.source} · Added: {checkResult.addedAt}</div>
              </div>
            ) : (
              <div className="rounded-md bg-green-500/10 border border-green-500/30 p-3 text-xs text-green-500 font-medium">
                CLEAR — address is not on the sanctions list
              </div>
            )
          )}
        </CardContent>
      </Card>

      {/* Audit log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audit Log</CardTitle>
          <CardDescription>All AML/OFAC events (newest first)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border bg-muted/40 font-mono text-xs p-3 h-52 overflow-y-auto space-y-0.5">
            {log.length === 0 ? (
              <p className="text-muted-foreground">No events yet.</p>
            ) : (
              log.map((entry, i) => (
                <div key={i} className={`flex gap-2 ${LOG_COLORS[entry.action] ?? "text-muted-foreground"}`}>
                  <span className="shrink-0 text-muted-foreground">{entry.at.replace("T", " ").slice(0, 19)}</span>
                  <span className="font-bold w-14 shrink-0">{entry.action}</span>
                  {entry.trigger === "KYC_ATTEMPT" && (
                    <span className="shrink-0 rounded px-1" style={{ background: "rgba(239,68,68,0.15)", color: "#f87171", fontSize: "10px", lineHeight: "1.6" }}>KYC</span>
                  )}
                  <span className="truncate">{entry.address}</span>
                  {entry.label && entry.label !== "—" && (
                    <span className="text-muted-foreground truncate">"{entry.label}"</span>
                  )}
                  {entry.action_by && (
                    <span className="text-muted-foreground shrink-0">by={entry.action_by}</span>
                  )}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

    </div>
  );
}

const RLUSD_CURRENCY = "524C555344000000000000000000000000000000";
const RLUSD_ISSUER   = process.env.NEXT_PUBLIC_RLUSD_ISSUER;

// ── tiny helpers ──────────────────────────────────────────────────────────────

function fmt(n, decimals = 4) {
  if (n == null || isNaN(n)) return "—";
  return `$${Number(n).toFixed(decimals)}`;
}

function rippleToDate(rippleTs) {
  if (!rippleTs) return "—";
  const RIPPLE_EPOCH = 946684800;
  const unix = Number(rippleTs) + RIPPLE_EPOCH;
  return new Date(unix * 1000).toLocaleString();
}

function shortHash(h) {
  if (!h) return "";
  return `${h.slice(0, 8)}…${h.slice(-8)}`;
}

function StatusDot({ ok }) {
  return (
    <span className={`inline-block h-2 w-2 rounded-full mr-1.5 ${ok ? "bg-green-500" : "bg-red-500"}`} />
  );
}

// ── Log panel ─────────────────────────────────────────────────────────────────

function LogPanel({ lines }) {
  return (
    <div className="rounded-md border bg-muted/40 font-mono text-xs p-3 h-40 overflow-y-auto space-y-0.5">
      {lines.length === 0 ? (
        <p className="text-muted-foreground">Waiting for activity…</p>
      ) : (
        lines.map((l, i) => (
          <div key={i} className={l.type === "error" ? "text-red-500" : l.type === "success" ? "text-green-600" : "text-muted-foreground"}>
            {l.text}
          </div>
        ))
      )}
    </div>
  );
}

// ── Oracle Status Card ────────────────────────────────────────────────────────

function OracleStatusCard({ status, onRefresh, loading }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Oracle Status</CardTitle>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            {loading ? "…" : "Refresh"}
          </Button>
        </div>
        <CardDescription>Live oracle prices on XRPL devnet</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {status === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !status.configured ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <StatusDot ok={false} />
            Not configured — run Setup Oracle below
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <StatusDot ok={true} />
              <span className="text-sm font-medium">Active</span>
              <Badge variant="secondary" className="text-xs">{status.network?.replace("wss://", "").split(":")[0]}</Badge>
            </div>

            <div className="rounded-md border divide-y text-sm">
              <Row label="Oracle Account" value={<code className="text-xs">{status.account}</code>} />
              <Row label="Document ID" value={status.docId} />
              <Row label="XRP / USD" value={<span className="font-semibold">{fmt(status.xrpUsd)}</span>} />
              <Row label="XAU / USD" value={<span className="font-semibold">{fmt(status.xauUsd, 2)}</span>} />
              <Row label="Last Update" value={rippleToDate(status.lastUpdateTime)} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

// ── Setup Oracle Card ─────────────────────────────────────────────────────────

function SetupOracleCard({ onLog, onRefreshStatus }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);

  async function run() {
    setLoading(true);
    setResult(null);
    onLog({ type: "info", text: "→ OracleSet — fetching live prices & submitting…" });
    try {
      const res  = await fetch("/api/admin/oracle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "setup" }) });
      const data = await res.json();
      setResult(data);
      if (data.ok) {
        onLog({ type: "success", text: `✔ OracleSet ${data.hash ? shortHash(data.hash) : ""}  XRP $${data.xrpPrice?.toFixed(4)}  XAU $${data.xauPrice?.toFixed(2)}` });
        onRefreshStatus();
      } else {
        onLog({ type: "error", text: `✖ ${data.error}` });
      }
    } catch (err) {
      onLog({ type: "error", text: `✖ ${err.message}` });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Setup Oracle</CardTitle>
        <CardDescription>Create / update the on-chain oracle with live XRP/USD + XAU/USD prices. Reads ORACLE_WALLET_SEED from .env.local or generates a new wallet.</CardDescription>
      </CardHeader>
      <CardContent>
        {result?.ok && (
          <div className="rounded-md bg-muted p-3 text-xs font-mono space-y-1 mb-3">
            <div><span className="text-muted-foreground">Account  </span>{result.account}</div>
            <div><span className="text-muted-foreground">Seed     </span>{result.seed}</div>
            <div><span className="text-muted-foreground">XRP/USD  </span>${result.xrpPrice?.toFixed(4)}</div>
            <div><span className="text-muted-foreground">XAU/USD  </span>${result.xauPrice?.toFixed(2)}</div>
            <div><span className="text-muted-foreground">Hash     </span>{result.hash}</div>
          </div>
        )}
        {result?.ok && (
          <p className="text-xs text-amber-600 mb-3">
            Add these to <code>.env.local</code> and restart dev server:
            <br />
            <code>ORACLE_WALLET_SEED={result.seed}</code>
            <br />
            <code>ORACLE_DOCUMENT_ID=1</code>
            <br />
            <code>NEXT_PUBLIC_ORACLE_ACCOUNT={result.account}</code>
          </p>
        )}
      </CardContent>
      <CardFooter>
        <Button onClick={run} disabled={loading} className="w-full">
          {loading ? "Submitting…" : "Run OracleSet"}
        </Button>
      </CardFooter>
    </Card>
  );
}

// ── Push Price Card ───────────────────────────────────────────────────────────

const MODES = [
  { value: "live",   label: "Live",   description: "Fetch real price from Binance / CoinGecko" },
  { value: "manual", label: "Manual", description: "Enter a custom price" },
  { value: "crash",  label: "Crash",  description: "Price × 0.01 — triggers liquidations" },
  { value: "pump",   label: "Pump",   description: "Price × 10 — over-collateralises" },
  { value: "stale",  label: "Stale",  description: "No transaction — simulates oracle silence" },
];

function PushPriceCard({ onLog, onRefreshStatus }) {
  const [mode, setMode]       = useState("live");
  const [price, setPrice]     = useState("");
  const [scale, setScale]     = useState(6);
  const [loading, setLoading] = useState(false);
  const [lastTx, setLastTx]   = useState(null);

  async function push() {
    setLoading(true);
    setLastTx(null);
    const label = MODES.find(m => m.value === mode)?.label ?? mode;
    onLog({ type: "info", text: `→ OracleSet push [${label}]${mode === "manual" ? ` $${price}` : ""}` });
    try {
      const body = { action: "push", mode, scale };
      if (mode === "manual") body.price = parseFloat(price);
      const res  = await fetch("/api/admin/oracle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.ok) {
        setLastTx(data);
        if (data.mode === "stale") {
          onLog({ type: "info", text: "  ⏸ Stale mode — oracle silent, no tx" });
        } else {
          onLog({ type: "success", text: `✔ ${shortHash(data.hash)}  XRP $${data.price?.toFixed(4)} (scale ${data.scale})` });
          onRefreshStatus();
        }
      } else {
        onLog({ type: "error", text: `✖ ${data.error}` });
      }
    } catch (err) {
      onLog({ type: "error", text: `✖ ${err.message}` });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Push Oracle Price</CardTitle>
        <CardDescription>Submit a new XRP/USD price to the on-chain oracle. Requires <code>ORACLE_WALLET_SEED</code> in .env.local.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Mode selector */}
        <div className="space-y-1.5">
          <Label>Mode</Label>
          <div className="grid grid-cols-5 gap-1">
            {MODES.map(m => (
              <button
                key={m.value}
                onClick={() => setMode(m.value)}
                title={m.description}
                className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                  mode === m.value
                    ? m.value === "crash" ? "bg-red-600 text-white border-red-600"
                    : m.value === "pump"  ? "bg-green-600 text-white border-green-600"
                    : m.value === "stale" ? "bg-amber-500 text-white border-amber-500"
                    : "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-accent"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{MODES.find(m => m.value === mode)?.description}</p>
        </div>

        {/* Manual price input */}
        {mode === "manual" && (
          <div className="space-y-1.5">
            <Label>XRP/USD Price</Label>
            <Input
              type="number"
              step="0.0001"
              min="0"
              placeholder="e.g. 2.4500"
              value={price}
              onChange={e => setPrice(e.target.value)}
            />
          </div>
        )}

        {/* Scale */}
        <div className="space-y-1.5">
          <Label>Scale</Label>
          <Input
            type="number"
            min="0"
            max="10"
            value={scale}
            onChange={e => setScale(parseInt(e.target.value, 10))}
          />
        </div>

        {/* Last tx */}
        {lastTx?.hash && (
          <div className="rounded-md bg-muted p-2 text-xs font-mono">
            <span className="text-muted-foreground">hash </span>{lastTx.hash}
            <br />
            <span className="text-muted-foreground">price </span>${lastTx.price?.toFixed(4)}
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button
          onClick={push}
          disabled={loading || (mode === "manual" && !price)}
          variant={mode === "crash" ? "destructive" : "default"}
          className="w-full"
        >
          {loading ? "Submitting…" : "Push Price"}
        </Button>
      </CardFooter>
    </Card>
  );
}

// ── Live Market Prices Card ───────────────────────────────────────────────────

function MarketPricesCard({ onLog }) {
  const [prices, setPrices] = useState(null);
  const [loading, setLoading] = useState(false);

  async function fetch_() {
    setLoading(true);
    onLog({ type: "info", text: "→ Fetching live market prices…" });
    try {
      const res  = await fetch("/api/admin/oracle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status" }) });
      const data = await res.json();
      if (data.ok) {
        setPrices(data);
        onLog({ type: "success", text: `✔ XRP $${data.xrpUsd?.toFixed(4)}  XAU $${data.xauUsd?.toFixed(2)}` });
      } else {
        onLog({ type: "error", text: `✖ ${data.error}` });
      }
    } catch (err) {
      onLog({ type: "error", text: `✖ ${err.message}` });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Live Market Prices</CardTitle>
          <Button variant="outline" size="sm" onClick={fetch_} disabled={loading}>
            {loading ? "…" : "Fetch"}
          </Button>
        </div>
        <CardDescription>Binance / CoinGecko — not from XRPL</CardDescription>
      </CardHeader>
      <CardContent>
        {prices ? (
          <div className="rounded-md border divide-y text-sm">
            <Row label="XRP / USD" value={<span className="font-semibold">{fmt(prices.xrpUsd)}</span>} />
            <Row label="XAU / USD" value={<span className="font-semibold">{fmt(prices.xauUsd, 2)}</span>} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Click Fetch to load prices</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Env Vars Card ─────────────────────────────────────────────────────────────

function EnvVarsCard() {
  const pub = {
    NEXT_PUBLIC_ORACLE_ACCOUNT:      process.env.NEXT_PUBLIC_ORACLE_ACCOUNT,
    NEXT_PUBLIC_ORACLE_DOCUMENT_ID:  process.env.NEXT_PUBLIC_ORACLE_DOCUMENT_ID,
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Env Vars (public)</CardTitle>
        <CardDescription>Only NEXT_PUBLIC_ vars are visible client-side. Check .env.local for private vars.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border divide-y text-sm">
          {Object.entries(pub).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between px-3 py-2 gap-2">
              <span className="text-muted-foreground font-mono text-xs shrink-0">{k}</span>
              {v ? (
                <code className="text-xs truncate max-w-[180px]">{v}</code>
              ) : (
                <Badge variant="destructive" className="text-xs">not set</Badge>
              )}
            </div>
          ))}
          {["ORACLE_WALLET_SEED", "ORACLE_DOCUMENT_ID", "XRPL_NETWORK_ENDPOINT"].map(k => (
            <div key={k} className="flex items-center justify-between px-3 py-2 gap-2">
              <span className="text-muted-foreground font-mono text-xs shrink-0">{k}</span>
              <Badge variant="secondary" className="text-xs">server-only</Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Loan Broker Credential Card ───────────────────────────────────────────────

function BrokerCredentialCard({ onLog }) {
  const defaultAddr = process.env.NEXT_PUBLIC_LOAN_BROKER_ADDRESS ?? "";
  const [address, setAddress] = useState(defaultAddr);
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);

  async function issue() {
    setLoading(true);
    setResult(null);
    onLog({ type: "info", text: `→ Issuing EDEL_KYC credential to loan broker ${address}…` });
    try {
      const res  = await fetch("/api/admin/broker-credential", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ brokerAddress: address.trim() }),
      });
      const data = await res.json();
      setResult(data);
      if (data.ok) {
        onLog({ type: "success", text: `✔ EDEL_KYC issued & accepted — create ${shortHash(data.createHash)}  accept ${shortHash(data.acceptHash)}` });
      } else {
        onLog({ type: "error", text: `✖ ${data.error}` });
      }
    } catch (err) {
      onLog({ type: "error", text: `✖ ${err.message}` });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Loan Broker Credential</CardTitle>
        <CardDescription>
          Issue the <code>EDEL_KYC</code> credential to the loan broker account. Requires{" "}
          <code>PLATFORM_ISSUER_WALLET_SEED</code> and <code>LOAN_BROKER_WALLET_SEED</code> in .env.local.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label>Loan Broker Address</Label>
          <Input
            placeholder="rXXX…"
            value={address}
            onChange={e => setAddress(e.target.value)}
          />
        </div>
        {result?.ok && (
          <div className="rounded-md bg-muted p-3 text-xs font-mono space-y-1">
            <div><span className="text-muted-foreground">Issuer        </span>{result.issuer}</div>
            <div><span className="text-muted-foreground">Broker        </span>{result.broker}</div>
            <div><span className="text-muted-foreground">CredentialType </span>{result.credentialType}</div>
            <div><span className="text-muted-foreground">CredentialCreate </span>{result.createHash}</div>
            <div><span className="text-muted-foreground">CredentialAccept </span>{result.acceptHash}</div>
          </div>
        )}
        {result && !result.ok && (
          <p className="text-xs text-destructive">{result.error}</p>
        )}
      </CardContent>
      <CardFooter>
        <Button onClick={issue} disabled={loading || !address.trim()} className="w-full">
          {loading ? "Submitting…" : "Issue EDEL_KYC Credential"}
        </Button>
      </CardFooter>
    </Card>
  );
}

// ── Update Domain Card ────────────────────────────────────────────────────────

function UpdateDomainCard({ onLog }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);

  const credType = process.env.NEXT_PUBLIC_CREDENTIAL_TYPE ?? "(not set)";

  async function run() {
    setLoading(true);
    setResult(null);
    onLog({ type: "info", text: `→ PermissionedDomainSet — updating to accept ${credType}…` });
    try {
      const res  = await fetch("/api/admin/update-domain", { method: "POST" });
      const data = await res.json();
      setResult(data);
      if (data.ok) {
        onLog({ type: "success", text: `✔ Domain updated ${shortHash(data.hash)}` });
      } else {
        onLog({ type: "error", text: `✖ ${data.error}` });
      }
    } catch (err) {
      onLog({ type: "error", text: `✖ ${err.message}` });
      setResult({ ok: false, error: err.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Update Permissioned Domain</CardTitle>
        <CardDescription>
          Updates the on-chain domain <code>AcceptedCredentials</code> to match{" "}
          <code>NEXT_PUBLIC_CREDENTIAL_TYPE</code>. Run this if the domain rejects deposits (<code>tecNO_AUTH</code>).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border divide-y text-sm">
          <Row label="Credential type" value={<code className="text-xs">{credType}</code>} />
          <Row label="Domain ID"       value={<code className="text-xs">{process.env.NEXT_PUBLIC_PERMISSIONED_DOMAIN_ID ?? "—"}</code>} />
        </div>
        {result?.ok && (
          <div className="rounded-md bg-muted p-2 text-xs font-mono">
            <span className="text-muted-foreground">hash </span>{result.hash}
          </div>
        )}
        {result && !result.ok && (
          <p className="text-xs text-destructive">{result.error}</p>
        )}
      </CardContent>
      <CardFooter>
        <Button onClick={run} disabled={loading} className="w-full">
          {loading ? "Submitting…" : "Update Domain AcceptedCredentials"}
        </Button>
      </CardFooter>
    </Card>
  );
}

// ── RLUSD Faucet Card ─────────────────────────────────────────────────────────

function RlusdFaucetCard({ onLog }) {
  const { isConnected, accountInfo, walletManager } = useWallet();
  const address = accountInfo?.address;

  const [state, setState]         = useState("idle"); // idle | trustset | sending | done | error
  const [trustHash, setTrustHash] = useState(null);
  const [sendHash, setSendHash]   = useState(null);
  const [error, setError]         = useState(null);

  const reset = () => { setState("idle"); setTrustHash(null); setSendHash(null); setError(null); };

  async function run() {
    if (!walletManager || !address) return;
    setState("trustset");
    setError(null);
    onLog({ type: "info", text: `→ TrustSet RLUSD for ${address}…` });

    try {
      // Step 1 — sign TrustSet via connected wallet
      const trustResult = await walletManager.signAndSubmit({
        TransactionType: "TrustSet",
        Account:         address,
        LimitAmount: {
          currency: RLUSD_CURRENCY,
          issuer:   RLUSD_ISSUER,
          value:    "10000000",
        },
      });

      const txResult = trustResult?.result?.meta?.TransactionResult ?? trustResult?.meta?.TransactionResult;
      if (txResult && txResult !== "tesSUCCESS" && txResult !== "tecNO_CHANGE") {
        throw new Error(`TrustSet failed: ${txResult}`);
      }
      const tHash = trustResult?.hash ?? trustResult?.result?.hash ?? trustResult?.id;
      setTrustHash(tHash ?? null);
      onLog({ type: "success", text: `✔ TrustSet OK${tHash ? "  " + shortHash(tHash) : ""}` });

      // Step 2 — auto-send 5000 RLUSD from issuer
      setState("sending");
      onLog({ type: "info", text: `→ Sending 5000 RLUSD to ${address}…` });
      const res  = await fetch("/api/admin/rlusd-faucet", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ destination: address }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Send failed");
      setSendHash(data.hash);
      onLog({ type: "success", text: `✔ 5000 RLUSD sent  ${shortHash(data.hash)}` });
      setState("done");
    } catch (err) {
      setError(err.message);
      setState("error");
      onLog({ type: "error", text: `✖ ${err.message}` });
    }
  }

  const busy = state === "trustset" || state === "sending";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">RLUSD Faucet</CardTitle>
        <CardDescription>
          Sign a TrustSet for RLUSD with the connected wallet, then automatically receive 5,000 RLUSD from the issuer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!isConnected ? (
          <p className="text-sm text-muted-foreground">Connect a wallet first.</p>
        ) : (
          <div className="rounded-md bg-muted p-2 text-xs font-mono break-all">
            <span className="text-muted-foreground">address </span>{address}
          </div>
        )}

        {state === "trustset" && (
          <p className="text-xs text-muted-foreground">Step 1/2 — sign TrustSet in your wallet…</p>
        )}
        {state === "sending" && (
          <p className="text-xs text-muted-foreground">Step 2/2 — sending 5,000 RLUSD...</p>
        )}

        {(state === "done" || trustHash || sendHash) && (
          <div className="rounded-md bg-muted p-2 text-xs font-mono space-y-0.5">
            {trustHash && <div><span className="text-muted-foreground">TrustSet </span>{trustHash}</div>}
            {sendHash  && <div><span className="text-muted-foreground">Payment  </span>{sendHash}</div>}
          </div>
        )}

        {state === "error" && (
          <p className="text-xs text-destructive">{error}</p>
        )}
      </CardContent>
      <CardFooter className="flex gap-2">
        <Button onClick={run} disabled={busy || !isConnected} className="flex-1">
          {state === "trustset" ? "Signing TrustSet…"
           : state === "sending" ? "Sending RLUSD…"
           : "Set TrustLine & Receive 5,000 RLUSD"}
        </Button>
        {(state === "done" || state === "error") && (
          <Button variant="outline" onClick={reset}>Reset</Button>
        )}
      </CardFooter>
    </Card>
  );
}

// ── Local Faucet Card ─────────────────────────────────────────────────────────

function FaucetCard({ onLog }) {
  const [destination, setDestination] = useState("");
  const [loading, setLoading]         = useState(false);
  const [health, setHealth]           = useState(null);
  const [lastFund, setLastFund]       = useState(null);

  async function call(action, extra = {}) {
    setLoading(true);
    try {
      const res  = await fetch("/api/admin/faucet", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      return data;
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }

  async function checkHealth() {
    onLog({ type: "info", text: "→ Faucet health check…" });
    const data = await call("health");
    setHealth(data);
    if (data.ok) {
      onLog({ type: "success", text: `✔ Node ${data.server_state}  ledger #${data.ledger}` });
    } else {
      onLog({ type: "error", text: `✖ ${data.error}` });
    }
  }

  async function fund() {
    const dest = destination.trim() || undefined;
    onLog({ type: "info", text: `→ Funding ${dest ?? "new wallet"}…` });
    const data = await call("fund", dest ? { destination: dest } : {});
    if (data.ok) {
      setLastFund(data);
      onLog({ type: "success", text: `✔ +${data.amount} XRP → ${data.account?.classicAddress}` });
    } else {
      onLog({ type: "error", text: `✖ ${data.error}` });
    }
  }

  async function acceptLedger() {
    onLog({ type: "info", text: "→ ledger_accept…" });
    const data = await call("ledger-accept");
    if (data.ok) {
      onLog({ type: "success", text: `✔ Ledger closed — index ${data.ledger_current_index}` });
    } else {
      onLog({ type: "error", text: `✖ ${data.error}` });
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Local Faucet</CardTitle>
          <Button variant="outline" size="sm" onClick={checkHealth} disabled={loading}>
            {health?.ok ? <><StatusDot ok={true} />Online</> : "Check"}
          </Button>
        </div>
        <CardDescription>
          Funds accounts via genesis wallet. Requires <code>pnpm faucet</code> running on port 7007.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label>Destination (optional)</Label>
          <Input
            placeholder="rXXX… — leave empty to generate new wallet"
            value={destination}
            onChange={e => setDestination(e.target.value)}
          />
        </div>

        {lastFund?.account && (
          <div className="rounded-md bg-muted p-2 text-xs font-mono space-y-0.5">
            <div><span className="text-muted-foreground">address </span>{lastFund.account.classicAddress}</div>
            {lastFund.account.secret && <div><span className="text-muted-foreground">secret  </span>{lastFund.account.secret}</div>}
            <div><span className="text-muted-foreground">amount  </span>+{lastFund.amount} XRP</div>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex gap-2">
        <Button onClick={fund} disabled={loading} className="flex-1">
          {loading ? "…" : "Fund Account"}
        </Button>
        <Button variant="outline" onClick={acceptLedger} disabled={loading}>
          Close Ledger
        </Button>
      </CardFooter>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "oracle", label: "Oracle & Devnet" },
  { id: "loans",  label: "Loan Management" },
  { id: "ofac",   label: "AML / OFAC" },
];

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState("oracle");
  const [oracleStatus, setOracleStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [logs, setLogs] = useState([]);

  const addLog = useCallback((entry) => {
    setLogs(prev => [...prev.slice(-200), entry]);
  }, []);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res  = await fetch("/api/admin/oracle");
      const data = await res.json();
      setOracleStatus(data);
    } catch (err) {
      addLog({ type: "error", text: `Status fetch error: ${err.message}` });
    } finally {
      setStatusLoading(false);
    }
  }, [addLog]);

  useEffect(() => { if (activeTab === "oracle") refreshStatus(); }, [activeTab, refreshStatus]);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1">
        <div className="container py-6">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
            <p className="text-muted-foreground">Oracle management &amp; devnet tooling</p>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 p-1 rounded-xl bg-secondary border border-border w-fit mb-6">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "oracle" && (
            <>
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <OracleStatusCard
                  status={oracleStatus}
                  onRefresh={refreshStatus}
                  loading={statusLoading}
                />
                <MarketPricesCard onLog={addLog} />
                <EnvVarsCard />
                <SetupOracleCard      onLog={addLog} onRefreshStatus={refreshStatus} />
                <PushPriceCard        onLog={addLog} onRefreshStatus={refreshStatus} />
                <BrokerCredentialCard onLog={addLog} />
                <UpdateDomainCard    onLog={addLog} />
                <RlusdFaucetCard     onLog={addLog} />
                <FaucetCard          onLog={addLog} />
              </div>

              {/* Activity log */}
              <div className="mt-6 space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Activity Log</h2>
                  <Button variant="ghost" size="sm" onClick={() => setLogs([])}>Clear</Button>
                </div>
                <LogPanel lines={logs} />
              </div>
            </>
          )}

          {activeTab === "loans" && (
            <div className="space-y-6">
              <LoanManagementTab onLog={addLog} />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Activity Log</h2>
                  <Button variant="ghost" size="sm" onClick={() => setLogs([])}>Clear</Button>
                </div>
                <LogPanel lines={logs} />
              </div>
            </div>
          )}

          {activeTab === "ofac" && <OfacTab />}
        </div>
      </main>

      <footer className="border-t py-6">
        <div className="container text-center text-sm text-muted-foreground">
          Built with edeLLand
        </div>
      </footer>
    </div>
  );
}
