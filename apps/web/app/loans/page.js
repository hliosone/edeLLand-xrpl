"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link                                          from "next/link";
import { ShieldCheck, Loader2 }                      from "lucide-react";
import { useWallet } from "../../components/providers/WalletProvider";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";

// ── KYC credential check ──────────────────────────────────────────────────────

const CREDENTIAL_ISSUER = process.env.NEXT_PUBLIC_CREDENTIAL_ISSUER;
const KYC_ONE_TYPE      = process.env.NEXT_PUBLIC_CREDENTIAL_TYPE || "4B59435F4F4E45";

function useCredentials(address) {
  const [data, setData]   = useState(undefined);
  const [error, setError] = useState(null);
  const refetch = useCallback(() => {
    if (!address) { setData(null); return; }
    setData(undefined);
    fetch(`/api/account/credential?address=${encodeURIComponent(address)}`)
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d.credentials ?? []); })
      .catch(err => { setError(err.message); setData([]); });
  }, [address]);
  useEffect(() => { refetch(); }, [refetch]);
  const kycOne = data?.find(c => c.credentialType === KYC_ONE_TYPE && c.accepted) ?? null;
  return { loading: data === undefined, kycOne };
}

// ── Collateral health ─────────────────────────────────────────────────────────

const WARNING_THRESHOLD     = parseFloat(process.env.NEXT_PUBLIC_COLLATERAL_WARNING_THRESHOLD     ?? "120");
const LIQUIDATION_THRESHOLD = parseFloat(process.env.NEXT_PUBLIC_COLLATERAL_LIQUIDATION_THRESHOLD ?? "112");

// Polls collateral health (positions + XRP price) every 30 s.
// Also drives the live XRP price shown on the page header.
function useCollateralHealth(address) {
  const [health,  setHealth]  = useState(null);  // { xrpUsd, positions[] }
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      // Always fetch all-user health so we get xrpUsd even if no active positions
      const res  = await fetch(`/api/loans/collateral/health?userAddress=${address}`);
      const data = await res.json();
      if (!data.error) setHealth(data);
    } catch {}
    finally { setLoading(false); }
  }, [address]);

  useEffect(() => {
    if (!address) { setHealth(null); return; }
    refresh();
    intervalRef.current = setInterval(refresh, 30_000); // refresh every 30 s
    return () => clearInterval(intervalRef.current);
  }, [address, refresh]);

  return { health, loading, refresh };
}

// Lightweight XRP price hook — used when no collateral positions exist
// but user is still on the page and wants to see live price.
function useXrpPrice() {
  const [xrpUsd, setXrpUsd] = useState(null);
  const intervalRef          = useRef(null);

  const fetch30s = useCallback(async () => {
    try {
      const res  = await fetch("/api/admin/oracle", { method: "GET" });
      const data = await res.json();
      if (data.xrpUsd) setXrpUsd(data.xrpUsd);
    } catch {}
  }, []);

  useEffect(() => {
    fetch30s();
    intervalRef.current = setInterval(fetch30s, 30_000);
    return () => clearInterval(intervalRef.current);
  }, [fetch30s]);

  return xrpUsd;
}

// ── CollateralHealthBadge — inline on each loan card ─────────────────────────

function CollateralHealthBadge({ loanId, healthData }) {
  if (!healthData?.positions?.length) return null;
  const pos = healthData.positions.find((p) => p.loanId === loanId);
  if (!pos) return null;

  const { health, warning, critical, xrpLocked } = pos;
  const variant = critical ? "destructive" : warning ? "warning" : "success";
  const label   = critical ? `${health}% CRITICAL`
                : warning  ? `${health}% WARNING`
                :             `${health}% Healthy`;

  return (
    <div className="mt-3 rounded-md border px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Collateral health</span>
        <Badge variant={variant} className="text-xs">{label}</Badge>
      </div>

      {/* Health bar */}
      <div className="relative h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            critical ? "bg-destructive" : warning ? "bg-amber-500" : "bg-green-500"
          }`}
          style={{ width: `${Math.min(health ?? 0, 200) / 2}%` }}
        />
        {/* Threshold markers */}
        <div className="absolute top-0 bottom-0 w-px bg-amber-500/70"    style={{ left: `${WARNING_THRESHOLD     / 2}%` }} />
        <div className="absolute top-0 bottom-0 w-px bg-destructive/70"  style={{ left: `${LIQUIDATION_THRESHOLD / 2}%` }} />
      </div>

      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{LIQUIDATION_THRESHOLD}% liq.</span>
        <span>{xrpLocked} XRP locked</span>
        <span>{WARNING_THRESHOLD}% warn</span>
      </div>

      {(critical || warning) && (
        <div className={`rounded-md px-2.5 py-1.5 text-xs ${
          critical
            ? "bg-destructive/10 border border-destructive/30 text-destructive"
            : "bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400"
        }`}>
          {critical
            ? "Position at risk of liquidation. Add collateral immediately or repay the loan."
            : `Add collateral to stay above ${WARNING_THRESHOLD}%. Current health is close to liquidation threshold.`}
        </div>
      )}
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RIPPLE_EPOCH = 946684800; // Unix timestamp of XRPL epoch

// Fixed loan terms — flat 8% origination fee, no amortized interest
const LOAN_ORIGINATION_FEE_RATE = 0.08; // 8% of principal, deducted upfront
const LOAN_PAYMENT_TOTAL        = 3;
const LOAN_PAYMENT_INTERVAL     = 300;  // 5 minutes in seconds (devnet demo)
const LOAN_GRACE_PERIOD         = 60;   // 1 minute in seconds

// ── Helpers ───────────────────────────────────────────────────────────────────

function fromRippleEpoch(ts) {
  if (!ts) return null;
  return new Date((ts + RIPPLE_EPOCH) * 1000);
}

function nowRipple() {
  return Math.floor(Date.now() / 1000) - RIPPLE_EPOCH;
}

function fmtDate(ts) {
  const d = fromRippleEpoch(ts);
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function fmtRLUSD(value) {
  if (value == null || value === "") return "—";
  const n = parseFloat(value);
  if (isNaN(n)) return String(value);
  return (
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }) +
    " RLUSD"
  );
}

function fmtRate(raw) {
  if (raw == null) return "—";
  return (raw / 10_000).toFixed(4).replace(/\.?0+$/, "") + "%";
}

function fmtInterval(seconds) {
  if (!seconds) return "—";
  if (seconds < 60)   return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const days = Math.round(seconds / 86400);
  if (days >= 30) return `${Math.round(days / 30)} month(s)`;
  if (days >= 7)  return `${Math.round(days / 7)} week(s)`;
  if (days >= 1)  return `${days} day(s)`;
  return `${Math.round(seconds / 3600)}h`;
}

// Round UP using the loan's LoanScale from the ledger (spec: ceil(v × 10^-scale) × 10^scale)
function roundUpByScale(value, loanScale) {
  const factor = Math.pow(10, -loanScale);
  const result = Math.ceil(value * factor) / factor;
  return result.toFixed(Math.max(0, -loanScale));
}

function roundUpRLUSD(value) {
  return (Math.ceil(value * 1e6) / 1e6).toFixed(6);
}

// ── Loan status helpers ───────────────────────────────────────────────────────

function loanIsDefaulted(loan)    { return !!(loan.Flags & 0x00010000); }
function loanIsImpaired(loan)     { return !!(loan.Flags & 0x00020000); }
function loanIsClosed(loan)       { return loan.PaymentRemaining === 0; }

// Late = past due AND still within grace period → payable with tfLoanLatePayment
function loanIsLate(loan) {
  if (loanIsDefaulted(loan) || loanIsClosed(loan)) return false;
  const due   = loan.NextPaymentDueDate;
  const grace = loan.GracePeriod ?? 0;
  if (!due) return false;
  const now = nowRipple();
  return now > due && now <= due + grace;
}

// Grace expired = past due + grace period, not yet defaulted → tecEXPIRED on LoanPay, broker must act
function loanGraceExpired(loan) {
  if (loanIsDefaulted(loan) || loanIsClosed(loan)) return false;
  const due   = loan.NextPaymentDueDate;
  const grace = loan.GracePeriod ?? 0;
  if (!due) return false;
  return nowRipple() > due + grace;
}

function statusVariant(loan) {
  if (loanIsDefaulted(loan))   return "destructive";
  if (loanGraceExpired(loan))  return "destructive";
  if (loanIsLate(loan))        return "destructive";
  if (loanIsImpaired(loan))    return "warning";
  if (loanIsClosed(loan))      return "secondary";
  return "success";
}

function statusLabel(loan) {
  if (loanIsDefaulted(loan))   return "Defaulted";
  if (loanGraceExpired(loan))  return "Grace Expired";
  if (loanIsLate(loan))        return "Overdue";
  if (loanIsImpaired(loan))    return "Impaired";
  if (loanIsClosed(loan))      return "Closed";
  return "Active";
}

// ── Payment amount computation ────────────────────────────────────────────────

function computePayment(loan) {
  if (loanIsDefaulted(loan) || loanIsClosed(loan) || loanGraceExpired(loan)) return null;

  const isLast         = loan.PaymentRemaining === 1;
  const isLate         = loanIsLate(loan);
  const loanScale      = loan.LoanScale ?? -6;
  const periodicPayment = parseFloat(loan.PeriodicPayment);

  // If the ledger is missing PeriodicPayment, we can't compute a safe amount
  if (isNaN(periodicPayment) && !isLast) return null;

  if (isLast) {
    const total = parseFloat(loan.TotalValueOutstanding);
    if (isNaN(total)) return null;
    return {
      value:  roundUpByScale(total, loanScale),
      flags:  0,
      label:  "Pay Final Installment",
      isLate: false,
      isLast: true,
    };
  }

  if (isLate) {
    const secondsOverdue = nowRipple() - loan.NextPaymentDueDate;
    const lateRate       = ((loan.LateInterestRate ?? 0) / 1_000_000) * secondsOverdue / 31_536_000;
    const lateInterest   = (parseFloat(loan.PrincipalOutstanding) || 0) * lateRate;
    const latePaymentFee = parseFloat(loan.LatePaymentFee ?? "0") || 0;
    const serviceFee     = parseFloat(loan.LoanServiceFee ?? "0") || 0;
    const total          = periodicPayment + serviceFee + latePaymentFee + lateInterest;
    return {
      value:        roundUpByScale(total, loanScale),
      flags:        0x00040000,
      label:        "Pay Overdue Installment",
      isLate:       true,
      isLast:       false,
      lateInterest: lateInterest.toFixed(Math.max(0, -loanScale)),
    };
  }

  const serviceFee = parseFloat(loan.LoanServiceFee ?? "0") || 0;
  return {
    value:  roundUpByScale(periodicPayment + serviceFee, loanScale),
    flags:  0,
    label:  "Pay Installment",
    isLate: false,
    isLast: false,
  };
}

// ── Client-side periodic payment estimate (for the request form) ──────────────
// Flat fee model: InterestRate=0 → PeriodicPayment = principal / paymentTotal

function estimateMonthlyPayment(principalStr) {
  const principal = parseFloat(principalStr);
  if (!principal || isNaN(principal) || principal <= 0) return null;
  return principal / LOAN_PAYMENT_TOTAL; // equal installments, fee taken upfront
}

// ── XRPL fetch helper (via server proxy → local node) ─────────────────────────

async function xrplRequest(method, params) {
  const res  = await fetch("/api/xrpl", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

// ── useLoans hook ─────────────────────────────────────────────────────────────

function useLoans(address) {
  const [loans,   setLoans]   = useState(undefined); // undefined = loading
  const [error,   setError]   = useState(null);
  const [version, setVersion] = useState(0);          // bump to refetch

  const refetch = useCallback(() => setVersion((v) => v + 1), []);

  const fetchAddress = address;

  useEffect(() => {
    if (!address) { setLoans([]); setError(null); return; }
    setLoans(undefined);
    setError(null);

    xrplRequest("account_objects", { account: fetchAddress, type: "loan", ledger_index: "validated" })
      .then((r) => setLoans(r.account_objects ?? []))
      .catch((err) => { setError(err.message); setLoans([]); });
  }, [address, fetchAddress, version]);

  return { loans, loading: loans === undefined, error, refetch };
}

// ── LoanCard ──────────────────────────────────────────────────────────────────

const RLUSD_CURRENCY = "524C555344000000000000000000000000000000";
const RLUSD_ISSUER   = process.env.NEXT_PUBLIC_RLUSD_ISSUER;

function LoanCard({ loan, borrowerAddress, walletManager, onPaySuccess, healthData }) {
  const [open,      setOpen]      = useState(false);
  const [paying,    setPaying]    = useState(false);
  const [payResult, setPayResult] = useState(null);

  const payment       = computePayment(loan);
  const isOwnLoan     = loan.Borrower === borrowerAddress;

  async function handlePay() {
    if (!payment) return;
    setPaying(true);
    setPayResult(null);
    try {
      let hash, amountPaid;

      if (isOwnLoan && walletManager) {
        // Borrower = connected wallet → sign & submit via Xumm directly
        const tx = {
          TransactionType: "LoanPay",
          Account:         borrowerAddress,
          LoanID:          loan.index,
          Amount: { currency: RLUSD_CURRENCY, issuer: RLUSD_ISSUER, value: payment.value },
          Flags:           payment.flags,
        };
        console.group("[LoanPay] Xumm sign");
        console.log("loan raw    :", { index: loan.index, LoanScale: loan.LoanScale, PeriodicPayment: loan.PeriodicPayment, LoanServiceFee: loan.LoanServiceFee, TotalValueOutstanding: loan.TotalValueOutstanding, PaymentRemaining: loan.PaymentRemaining, NextPaymentDueDate: loan.NextPaymentDueDate });
        console.log("payment obj :", payment);
        console.log("tx sent     :", JSON.stringify(tx, null, 2));
        console.groupEnd();
        const result = await walletManager.signAndSubmit(tx);
        hash        = result?.hash;
        amountPaid  = payment.value;
      } else {
        // Borrower ≠ connected wallet (e.g. demo loans) → server-side payment
        const res  = await fetch("/api/loans/pay", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ loanId: loan.index }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          setPayResult({ ok: false, message: data.error ?? "Payment failed" });
          return;
        }
        hash       = data.hash;
        amountPaid = data.amountPaid;
      }

      setPayResult({
        ok:      true,
        message: payment.isLast
          ? `Final payment sent! Loan closed. (${amountPaid} RLUSD)`
          : `Payment of ${amountPaid} RLUSD sent${payment.isLate ? " (late)" : ""}.`,
        hash,
      });
      onPaySuccess();
    } catch (err) {
      setPayResult({ ok: false, message: err.message });
    } finally {
      setPaying(false);
    }
  }

  const variant = statusVariant(loan);
  const label   = statusLabel(loan);

  return (
    <div className="rounded-lg border p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <p className="font-semibold">{fmtRLUSD(loan.TotalValueOutstanding)} outstanding</p>
          <p className="text-xs text-muted-foreground font-mono truncate max-w-[280px]">
            {loan.index}
          </p>
        </div>
        <Badge variant={variant} className="shrink-0">{label}</Badge>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-md bg-muted/50 p-3 text-center">
          <p className="text-xs text-muted-foreground mb-0.5">Principal left</p>
          <p className="text-sm font-medium">{fmtRLUSD(loan.PrincipalOutstanding)}</p>
        </div>
        <div className="rounded-md bg-muted/50 p-3 text-center">
          <p className="text-xs text-muted-foreground mb-0.5">Payments left</p>
          <p className="text-sm font-medium">{loan.PaymentRemaining ?? "—"}</p>
        </div>
        <div className="rounded-md bg-muted/50 p-3 text-center">
          <p className="text-xs text-muted-foreground mb-0.5">Next due</p>
          <p className={`text-sm font-medium ${loanIsLate(loan) || loanGraceExpired(loan) ? "text-destructive" : ""}`}>
            {fmtDate(loan.NextPaymentDueDate)}
          </p>
        </div>
      </div>

      {/* Expandable details */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left"
      >
        {open ? "▲ Hide details" : "▼ Show details"}
      </button>

      {open && (
        <div className="divide-y border rounded-md text-sm">
          {[
            ["Monthly payment",   fmtRLUSD(loan.PeriodicPayment)],
            ["Origination fee",   fmtRLUSD(loan.LoanOriginationFee)],
            ["Late rate",         fmtRate(loan.LateInterestRate) + " annual"],
            ["Payment interval",  fmtInterval(loan.PaymentInterval)],
            ["Grace period",      fmtInterval(loan.GracePeriod)],
            ["Started",           fmtDate(loan.StartDate)],
            ["Prev due date",     fmtDate(loan.PreviousPaymentDueDate)],
            ["Interest left",     fmtRLUSD(
              loan.TotalValueOutstanding != null && loan.PrincipalOutstanding != null && loan.ManagementFeeOutstanding != null
                ? String(parseFloat(loan.TotalValueOutstanding) - parseFloat(loan.PrincipalOutstanding) - parseFloat(loan.ManagementFeeOutstanding ?? "0"))
                : null
            )],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between px-3 py-2">
              <span className="text-muted-foreground">{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>
      )}

      {/* Payment section */}
      {loanGraceExpired(loan) && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive space-y-0.5">
          <p className="font-medium">Payment window closed.</p>
          <p>The grace period has expired. The loan broker must now process a default before any further action can be taken.</p>
        </div>
      )}

      {payment && (
        <div className="space-y-2 pt-1">
          {payment.isLate && (
            <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive">
              Payment overdue. Late interest of {fmtRLUSD(payment.lateInterest)} has been added.
            </div>
          )}
          {payment.isLast && (
            <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              This is your final payment. Paying {fmtRLUSD(payment.value)} clears the full balance.
            </div>
          )}
          <Button
            onClick={handlePay}
            disabled={paying}
            variant={payment.isLate ? "destructive" : "default"}
            className="w-full"
          >
            {paying
              ? "Submitting payment…"
              : `${payment.label} · ${fmtRLUSD(payment.value)}`}
          </Button>
        </div>
      )}

      {/* Collateral health (only shown for collateralised loans tracked in store) */}
      <CollateralHealthBadge loanId={loan.index} healthData={healthData} />

      {/* Payment result */}
      {payResult && (
        <div
          className={`rounded-md px-3 py-2 text-sm ${
            payResult.ok
              ? "bg-green-500/10 border border-green-500/30 text-green-700 dark:text-green-400"
              : "bg-destructive/10 border border-destructive/30 text-destructive"
          }`}
        >
          <p>{payResult.message}</p>
          {payResult.hash && (
            <p className="font-mono text-xs mt-1 break-all opacity-70">tx: {payResult.hash}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── LoanRequestForm ───────────────────────────────────────────────────────────

function LoanRequestForm({ borrowerAddress, onSuccess }) {
  const [principal, setPrincipal] = useState("");
  const [loading,   setLoading]   = useState(false);
  const [step,      setStep]      = useState("form"); // "form" | "confirm" | "success" | "error"
  const [prepared,  setPrepared]  = useState(null);   // API preview data before confirm
  const [result,    setResult]    = useState(null);
  const [error,     setError]     = useState(null);

  const estimate = estimateMonthlyPayment(principal);

  // Step 1: preview loan terms before requesting
  async function handleRequest(e) {
    e.preventDefault();
    const p = parseFloat(principal);
    if (!p || p <= 0) { setError("Enter a valid principal amount."); return; }
    setError(null);
    // Show confirmation step with estimated terms
    setPrepared({
      principal:       p.toFixed(2),
      originationFee:  roundUpRLUSD(p * LOAN_ORIGINATION_FEE_RATE),
      amountReceived:  roundUpRLUSD(p * (1 - LOAN_ORIGINATION_FEE_RATE)),
      monthlyPayment:  estimate ? roundUpRLUSD(estimate) : "—",
      totalRepayment:  estimate ? roundUpRLUSD(estimate * LOAN_PAYMENT_TOTAL) : "—",
    });
    setStep("confirm");
  }

  // Step 2: actually create the loan on-chain
  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/api/loans/create", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ principalRLUSD: principal, borrowerAddress }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Loan creation failed");
        setStep("form");
        return;
      }
      setResult(data);
      setStep("success");
      onSuccess();
    } catch (err) {
      setError(err.message);
      setStep("form");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setPrincipal("");
    setStep("form");
    setPrepared(null);
    setResult(null);
    setError(null);
  }

  if (step === "success" && result) {
    return (
      <div className="rounded-lg border border-green-500/40 bg-green-500/5 p-6 space-y-4">
        <div>
          <p className="font-semibold text-green-700 dark:text-green-400">Loan created successfully!</p>
          <p className="text-sm text-muted-foreground mt-1">
            {prepared?.amountReceived} RLUSD disbursed (after 5% fee). First payment due {fmtDate(result.nextPaymentDueDate)}.
          </p>
        </div>
        <div className="divide-y border rounded-md text-sm">
          {[
            ["Loan ID",          result.loanId],
            ["Monthly payment",  fmtRLUSD(result.periodicPayment)],
            ["Installments",     `${result.paymentsTotal} × monthly`],
            ["First due",        fmtDate(result.nextPaymentDueDate)],
            ["Tx hash",          result.hash],
          ].map(([k, v]) => (
            <div key={k} className="flex items-start justify-between px-3 py-2 gap-4">
              <span className="text-muted-foreground shrink-0">{k}</span>
              <span className="font-mono text-xs break-all text-right">{v}</span>
            </div>
          ))}
        </div>
        <Button variant="outline" onClick={reset} className="w-full">Request Another Loan</Button>
      </div>
    );
  }

  if (step === "confirm" && prepared) {
    return (
      <div className="rounded-lg border p-6 space-y-4">
        <div>
          <p className="font-semibold">Review loan terms</p>
          <p className="text-sm text-muted-foreground">Confirm the details before submitting</p>
        </div>
        <div className="divide-y border rounded-md text-sm">
          {[
            ["Principal",         `${prepared.principal} RLUSD`],
            ["Origination fee",   `5% · ${prepared.originationFee} RLUSD`],
            ["Amount received",   `${prepared.amountReceived} RLUSD`],
            ["Installments",      `${LOAN_PAYMENT_TOTAL} × monthly`],
            ["Monthly payment",   `${prepared.monthlyPayment} RLUSD`],
            ["Total repayment",   `${prepared.totalRepayment} RLUSD`],
            ["Grace period",      "7 days per installment"],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between px-3 py-2">
              <span className="text-muted-foreground">{k}</span>
              <span className="font-medium">{v}</span>
            </div>
          ))}
        </div>
        {error && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
        )}
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setStep("form")} disabled={loading} className="flex-1">
            Back
          </Button>
          <Button onClick={handleConfirm} disabled={loading} className="flex-1">
            {loading ? "Creating loan…" : "Confirm & Create Loan"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground text-center">
          Broker countersigns server-side. Funds disbursed from vault on confirmation.
        </p>
      </div>
    );
  }

  // Default: form
  return (
    <form onSubmit={handleRequest} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="principal">Principal amount (RLUSD)</Label>
        <Input
          id="principal"
          type="number"
          min="1"
          step="0.01"
          placeholder="e.g. 100"
          value={principal}
          onChange={(e) => { setPrincipal(e.target.value); setError(null); }}
          required
        />
      </div>

      {/* Fixed terms */}
      <div className="rounded-md bg-muted/50 p-4 space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fixed loan terms</p>
        <div className="grid grid-cols-2 gap-y-2 text-sm">
          {[
            ["Origination fee", "5% flat (deducted upfront)"],
            ["Installments",    "3 monthly payments"],
            ["Payment type",    "Equal installments"],
            ["Grace period",    "7 days / installment"],
          ].map(([k, v]) => (
            <div key={k}>
              <p className="text-xs text-muted-foreground">{k}</p>
              <p className="font-medium">{v}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Live estimate */}
      {estimate && (
        <div className="rounded-md border border-dashed p-4 space-y-1">
          <p className="text-xs text-muted-foreground">Estimated repayment</p>
          <p className="text-xl font-semibold">{roundUpRLUSD(estimate)} RLUSD <span className="text-sm font-normal text-muted-foreground">/ month</span></p>
          <p className="text-xs text-muted-foreground">
            Total repayment: {roundUpRLUSD(estimate * LOAN_PAYMENT_TOTAL)} RLUSD
            {" · "}Origination fee: {roundUpRLUSD(parseFloat(principal) * LOAN_ORIGINATION_FEE_RATE)} RLUSD
          </p>
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
      )}

      <Button type="submit" className="w-full">Review Loan Terms</Button>
    </form>
  );
}

// ── Summary strip ─────────────────────────────────────────────────────────────

function SummaryStrip({ loans }) {
  const active   = loans.filter((l) => !loanIsDefaulted(l) && !loanIsClosed(l)).length;
  const overdue  = loans.filter((l) => loanIsLate(l)).length;
  const totalOut = loans.reduce((acc, l) => acc + parseFloat(l.TotalValueOutstanding ?? "0"), 0);

  return (
    <div className="grid grid-cols-3 gap-4 mb-6">
      {[
        ["Total outstanding", fmtRLUSD(String(totalOut))],
        ["Active loans",      String(active)],
        ["Overdue",           String(overdue)],
      ].map(([label, value]) => (
        <div key={label} className="rounded-lg border p-4 text-center space-y-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold">{value}</p>
        </div>
      ))}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center space-y-2">
      <p className="text-sm text-muted-foreground">No active loans</p>
      <p className="text-xs text-muted-foreground">
        Request a loan from the &quot;New Loan&quot; tab. Funds are disbursed from the RLUSD vault.
      </p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LoansPage() {
  const { isConnected, accountInfo, walletManager } = useWallet();
  const address = isConnected ? accountInfo?.address : null;
  const { loading: credLoading, kycOne }         = useCredentials(address);
  const { loans, loading, error, refetch }       = useLoans(address);
  const { health: healthData, refresh: refreshHealth } = useCollateralHealth(address);
  const fallbackXrpUsd = useXrpPrice();

  // Use the price from collateral health if available, otherwise fallback
  const xrpUsd = healthData?.xrpUsd ?? fallbackXrpUsd;

  if (!isConnected || !accountInfo) return null;

  if (credLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "#00d4ff" }} />
      </div>
    );
  }

  if (!kycOne) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="glass rounded-2xl p-10 text-center max-w-sm mx-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl mx-auto mb-5" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <ShieldCheck className="h-7 w-7" style={{ color: "rgba(241,245,249,0.4)" }} />
          </div>
          <p className="font-semibold mb-2" style={{ color: "rgba(241,245,249,0.9)" }}>KYC required</p>
          <p style={{ color: "rgba(241,245,249,0.4)", fontSize: "13px", lineHeight: 1.6, marginBottom: "20px" }}>
            You need a verified KYC identity before accessing loan products.
          </p>
          <Link href="/onboarding" className="btn-gradient w-full justify-center" style={{ borderRadius: "12px" }}>
            Complete KYC Onboarding
          </Link>
        </div>
      </div>
    );
  }

  const activeLoans   = (loans ?? []).filter((l) => !loanIsClosed(l) && !loanIsLate(l) && !loanGraceExpired(l) && !loanIsDefaulted(l));
  const overdueLoans  = (loans ?? []).filter((l) => !loanIsClosed(l) && (loanIsLate(l) || loanGraceExpired(l) || loanIsDefaulted(l)));
  const closedLoans   = (loans ?? []).filter((l) => loanIsClosed(l));

  // Critical positions banner
  const criticalPositions = (healthData?.positions ?? []).filter((p) => p.critical);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1">
        <div className="container py-6 max-w-2xl">

          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Loan Management</h1>
              <p className="text-muted-foreground text-sm mt-1">
                Fixed-term RLUSD loans · Collateralised &amp; standard
                {xrpUsd && (
                  <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-foreground/80">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    XRP/USD: ${xrpUsd.toFixed(4)}
                  </span>
                )}
              </p>
            </div>
            <Link href="/loans/new">
              <Button size="sm" variant="outline">+ Collateralised loan</Button>
            </Link>
          </div>

          {/* Critical positions global alert */}
          {criticalPositions.length > 0 && (
            <div className="mb-5 rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive space-y-1">
              <p className="font-semibold">
                {criticalPositions.length === 1
                  ? "1 collateral position is at risk of liquidation"
                  : `${criticalPositions.length} collateral positions are at risk of liquidation`}
              </p>
              <p className="text-xs">
                Health has dropped below {LIQUIDATION_THRESHOLD}%. Add collateral or repay your loan immediately to avoid auto-liquidation.
              </p>
            </div>
          )}

          <Tabs defaultValue="loans">
            <TabsList className="mb-6">
              <TabsTrigger value="loans">
                My Loans
                {(loans ?? []).length > 0 && (
                  <Badge variant="secondary" className="ml-2 text-xs">
                    {(loans ?? []).length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="new">New Loan</TabsTrigger>
            </TabsList>

            {/* ── My Loans tab ───────────────────────────────────────────────── */}
            <TabsContent value="loans">
              {loading && (
                <p className="text-sm text-muted-foreground animate-pulse py-4">
                  Fetching loans from ledger…
                </p>
              )}

              {error && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive mb-4">
                  Failed to fetch loans: {error}
                </div>
              )}

              {!loading && !error && (
                <>
                  <SummaryStrip loans={loans ?? []} />

                  {activeLoans.length === 0 && overdueLoans.length === 0 && closedLoans.length === 0 ? (
                    <EmptyState />
                  ) : (
                    <div className="space-y-4">
                      {activeLoans.map((loan) => (
                        <LoanCard
                          key={loan.index}
                          loan={loan}
                          borrowerAddress={address}
                          walletManager={walletManager}
                          onPaySuccess={() => { refetch(); refreshHealth(); }}
                          healthData={healthData}
                        />
                      ))}

                      {overdueLoans.length > 0 && (
                        <div className="space-y-2 pt-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Overdue loans
                          </p>
                          {overdueLoans.map((loan) => (
                            <LoanCard
                              key={loan.index}
                              loan={loan}
                              borrowerAddress={address}
                              walletManager={walletManager}
                              onPaySuccess={refetch}
                            />
                          ))}
                        </div>
                      )}

                      {closedLoans.length > 0 && (
                        <div className="space-y-2 pt-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Closed loans
                          </p>
                          {closedLoans.map((loan) => (
                            <LoanCard
                              key={loan.index}
                              loan={loan}
                              borrowerAddress={address}
                              walletManager={walletManager}
                              onPaySuccess={refetch}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-4 flex justify-end">
                    <Button variant="ghost" size="sm" onClick={refetch} disabled={loading}>
                      Refresh
                    </Button>
                  </div>
                </>
              )}
            </TabsContent>

            {/* ── New Loan tab ────────────────────────────────────────────────── */}
            <TabsContent value="new">
              <div className="space-y-4">
                {/* Collateral loan CTA */}
                <div className="rounded-lg border p-5 space-y-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h2 className="font-semibold">Collateralised Loan</h2>
                      <Badge variant="secondary" className="text-xs">KYC Over-18 required</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Lock XRP as collateral and borrow RLUSD. Real-time health monitoring via price oracle. Requires a one-time co-signing setup.
                    </p>
                  </div>
                  <Link href="/loans/new">
                    <Button className="w-full">Start collateralised loan →</Button>
                  </Link>
                </div>

                {/* Standard (uncollateralised) loan */}
                <div className="rounded-lg border p-5 space-y-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h2 className="font-semibold">Standard Loan</h2>
                      <Badge variant="outline" className="text-xs">KYC Full required</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Uncollateralised fixed-term loan from the RLUSD vault. Broker signs server-side.
                    </p>
                  </div>
                  <LoanRequestForm
                    borrowerAddress={address}
                    onSuccess={refetch}
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <footer className="border-t py-6">
        <div className="container text-center text-sm text-muted-foreground">
          edeLLand
        </div>
      </footer>
    </div>
  );
}
