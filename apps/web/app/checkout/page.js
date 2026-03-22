"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, CheckCircle2, Loader2, ShieldAlert, ShieldCheck, Wallet,
} from "lucide-react";
import { useWallet } from "../../components/providers/WalletProvider";

// ── Constants ─────────────────────────────────────────────────────────────────

const RIPPLE_EPOCH         = 946684800;
const PAYMENT_TOTAL        = 3;
const ORIGINATION_FEE_RATE = 0.08; // 8% deducted upfront, InterestRate = 0

function installmentAmount(principal) {
  // InterestRate = 0 → equal installments, borrower repays full principal
  return principal / PAYMENT_TOTAL;
}

function fmtDate(rippleTs) {
  if (!rippleTs) return "—";
  return new Date((rippleTs + RIPPLE_EPOCH) * 1000).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

// ── States ────────────────────────────────────────────────────────────────────

const S = {
  LOADING:    "loading",    // checking KYC on-chain
  NO_WALLET:  "no_wallet",  // wallet not connected
  NO_KYC:     "no_kyc",     // missing KYC_FULL
  NO_TIER:    "no_tier",    // has KYC_FULL but no tier credential
  OVER_LIMIT: "over_limit", // amount > tier max
  READY:      "ready",      // ready to confirm
  CONFIRMING: "confirming", // loan creation in progress
  SUCCESS:    "success",
  ERROR:      "error",
};

// ── Inner component (uses useSearchParams) ─────────────────────────────────────

function CheckoutInner() {
  const router                             = useRouter();
  const params                             = useSearchParams();
  const { isConnected, accountInfo, walletManager } = useWallet();

  const amount     = parseFloat(params.get("amount") ?? "0");
  const product    = params.get("product")  ?? "Product";
  const merchant   = params.get("merchant") ?? "Merchant";
  const returnUrl  = params.get("returnUrl") ?? "/shop";

  const [state,    setState]   = useState(S.LOADING);
  const [kyc,      setKyc]     = useState(null);   // { hasFull, tier, maxAmount }
  const [result,   setResult]  = useState(null);   // loan creation result
  const [error,    setError]   = useState(null);

  const address = isConnected ? accountInfo?.address : null;

  // ── KYC verification ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!isConnected || !address) { setState(S.NO_WALLET); return; }

    setState(S.LOADING);

    fetch(`/api/checkout/verify?address=${encodeURIComponent(address)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setKyc(data);

        if (!data.hasFull)           setState(S.NO_KYC);
        else if (!data.tier)         setState(S.NO_TIER);
        else if (amount > data.maxAmount) setState(S.OVER_LIMIT);
        else if (sessionStorage.getItem(`loan_done_${address}_${amount}_${product}`)) setState(S.SUCCESS);
        else                         setState(S.READY);
      })
      .catch((err) => { setError(err.message); setState(S.ERROR); });
  }, [address, isConnected, amount]);

  // ── Loan creation — dual-signature flow ──────────────────────────────────
  // 1. /api/loans/prepare → unsigned LoanSet (Account = borrower, Counterparty = broker)
  // 2. walletManager.sign() → XUMM asks user to sign (TxnSignature)
  // 3. /api/loans/create(signedBlob) → broker adds CounterpartySignature + submits

  const confirmLoan = useCallback(async () => {
    setState(S.CONFIRMING);
    setError(null);
    try {
      // Step 1 — prepare unsigned LoanSet (returns encoded txBlob)
      const prepRes  = await fetch("/api/loans/prepare", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ principalRLUSD: String(amount), borrowerAddress: address }),
      });
      const prepData = await prepRes.json();
      if (!prepRes.ok || !prepData.txBlob) throw new Error(prepData.error ?? "Loan preparation failed");

      // Step 2 — user signs via Xaman in txblob mode.
      // Passing { txblob } bypasses Xaman's codec so it signs raw bytes without
      // trying to decode LoanSet (unknown tx type in Xaman's binary codec).
      const signResult = await walletManager.sign({ txblob: prepData.txBlob });
      const signedBlob = signResult?.tx_blob ?? signResult?.hex_blob;

      // Step 3 — broker adds CounterpartySignature + submit
      const res  = await fetch("/api/loans/create", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ signedBlob, borrowerAddress: address }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Loan creation failed");
      setResult(data);
      sessionStorage.setItem(`loan_done_${address}_${amount}_${product}`, "1");
      setState(S.SUCCESS);
    } catch (err) {
      setError(err.message);
      setState(S.ERROR);
    }
  }, [amount, address, walletManager]);

  const installment   = installmentAmount(amount);
  const originationFee = (amount * ORIGINATION_FEE_RATE).toFixed(2);
  const tierMax  = kyc?.maxAmount ?? 0;
  const tierName = kyc?.tier ?? null;

  // ── Layout shell ──────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12" style={{ background: "#08090e" }}>

      {/* Brand header */}
      <div className="flex items-center gap-2.5 mb-8">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-xl font-bold text-white text-sm"
          style={{ background: "linear-gradient(135deg, #00d4ff, #7c3aed)" }}
        >
          E
        </div>
        <span className="font-semibold text-sm tracking-wide" style={{ color: "rgba(241,245,249,0.8)" }}>
          ede<span style={{ color: "#00d4ff" }}>LL</span>and <span style={{ color: "rgba(241,245,249,0.3)" }}>× {merchant}</span>
        </span>
      </div>

      <div className="w-full max-w-md">

        {/* Product summary */}
        <div
          className="rounded-2xl p-5 mb-4"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p style={{ color: "rgba(241,245,249,0.45)", fontSize: "12px" }}>Your order</p>
              <p className="font-semibold mt-0.5" style={{ color: "rgba(241,245,249,0.92)", fontSize: "15px" }}>{product}</p>
              <p style={{ color: "rgba(241,245,249,0.35)", fontSize: "12px" }}>{merchant}</p>
            </div>
            <div className="text-right">
              <p className="font-bold text-2xl" style={{ color: "rgba(241,245,249,0.95)" }}>{amount.toLocaleString()}</p>
              <p style={{ color: "rgba(241,245,249,0.35)", fontSize: "12px" }}>RLUSD</p>
            </div>
          </div>
        </div>

        {/* Main card */}
        <div
          className="rounded-2xl p-6 space-y-5"
          style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.08)" }}
        >

          {/* ── LOADING ── */}
          {state === S.LOADING && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#00d4ff" }} />
              <p style={{ color: "rgba(241,245,249,0.5)", fontSize: "13px" }}>Verifying your credentials...</p>
            </div>
          )}

          {/* ── NO WALLET ── */}
          {state === S.NO_WALLET && (
            <div className="space-y-4 text-center py-4">
              <Wallet className="h-10 w-10 mx-auto" style={{ color: "rgba(241,245,249,0.3)" }} />
              <p className="font-semibold" style={{ color: "rgba(241,245,249,0.85)" }}>Wallet not connected</p>
              <p style={{ color: "rgba(241,245,249,0.4)", fontSize: "13px", lineHeight: 1.6 }}>
                Connect your wallet to access installment payments.
              </p>
              <Link href={returnUrl}>
                <button
                  className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium mt-2"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(241,245,249,0.7)" }}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to shop
                </button>
              </Link>
            </div>
          )}

          {/* ── NO KYC ── */}
          {state === S.NO_KYC && (
            <div className="space-y-4">
              <div
                className="flex items-start gap-3 rounded-xl p-4"
                style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)" }}
              >
                <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5" style={{ color: "#f87171" }} />
                <div>
                  <p className="font-semibold text-sm" style={{ color: "#f87171" }}>KYC_FULL required</p>
                  <p style={{ color: "rgba(241,245,249,0.4)", fontSize: "12.5px", lineHeight: 1.6, marginTop: "4px" }}>
                    You need to complete full KYC to access installment payments. It takes less than 2 minutes.
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  const target = `/checkout?amount=${amount}&product=${encodeURIComponent(product)}&merchant=${encodeURIComponent(merchant)}&returnUrl=${encodeURIComponent(returnUrl)}`;
                  router.push(`/onboarding?return=${encodeURIComponent(target)}`);
                }}
                className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold"
                style={{ background: "linear-gradient(135deg,#00d4ff,#7c3aed)", color: "#fff" }}
              >
                <ShieldCheck className="h-4 w-4" />
                Start Full KYC
                <ArrowRight className="h-4 w-4" />
              </button>
              <Link href={returnUrl}>
                <button
                  className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(241,245,249,0.5)" }}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to shop
                </button>
              </Link>
            </div>
          )}

          {/* ── NO TIER ── */}
          {state === S.NO_TIER && (
            <div className="space-y-4">
              <div
                className="flex items-start gap-3 rounded-xl p-4"
                style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)" }}
              >
                <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5" style={{ color: "#f59e0b" }} />
                <div>
                  <p className="font-semibold text-sm" style={{ color: "#f59e0b" }}>Credit tier not set</p>
                  <p style={{ color: "rgba(241,245,249,0.4)", fontSize: "12.5px", lineHeight: 1.6, marginTop: "4px" }}>
                    Your KYC_FULL is validated but your borrowing capacity has not been assessed yet.
                    Complete onboarding to get your KYC_TIER credential.
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  const target = `/checkout?amount=${amount}&product=${encodeURIComponent(product)}&merchant=${encodeURIComponent(merchant)}&returnUrl=${encodeURIComponent(returnUrl)}`;
                  router.push(`/onboarding?return=${encodeURIComponent(target)}`);
                }}
                className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold"
                style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.35)", color: "#f59e0b" }}
              >
                <ShieldCheck className="h-4 w-4" />
                Assess my borrowing capacity
                <ArrowRight className="h-4 w-4" />
              </button>
              <Link href={returnUrl}>
                <button
                  className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(241,245,249,0.5)" }}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to shop
                </button>
              </Link>
            </div>
          )}

          {/* ── OVER LIMIT ── */}
          {state === S.OVER_LIMIT && (
            <div className="space-y-4">
              <div
                className="flex items-start gap-3 rounded-xl p-4"
                style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)" }}
              >
                <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5" style={{ color: "#f87171" }} />
                <div>
                  <p className="font-semibold text-sm" style={{ color: "#f87171" }}>Amount exceeds your credit limit</p>
                  <p style={{ color: "rgba(241,245,249,0.4)", fontSize: "12.5px", lineHeight: 1.6, marginTop: "4px" }}>
                    This product costs <strong style={{ color: "rgba(241,245,249,0.7)" }}>{amount} RLUSD</strong> but your tier{" "}
                    <span
                      className="px-1.5 py-0.5 rounded text-xs font-mono"
                      style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}
                    >
                      {tierName}
                    </span>{" "}
                    allows up to <strong style={{ color: "rgba(241,245,249,0.7)" }}>{tierMax} RLUSD</strong>.
                  </p>
                </div>
              </div>
              <Link href={returnUrl}>
                <button
                  className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(241,245,249,0.6)" }}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to shop
                </button>
              </Link>
            </div>
          )}

          {/* ── READY ── */}
          {state === S.READY && (
            <div className="space-y-5">
              {/* Credential badge */}
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" style={{ color: "#10b981" }} />
                <span style={{ color: "#10b981", fontSize: "13px", fontWeight: 600 }}>Identity verified</span>
                <span
                  className="px-2 py-0.5 rounded-full text-xs font-semibold"
                  style={{ background: "rgba(0,212,255,0.12)", color: "#00d4ff", border: "1px solid rgba(0,212,255,0.25)" }}
                >
                  {tierName}
                </span>
              </div>

              {/* Loan terms */}
              <div
                className="rounded-xl overflow-hidden"
                style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}
              >
                {[
                  ["Principal",            `${amount.toLocaleString()} RLUSD`],
                  ["Origination fee",      `${originationFee} RLUSD (8%, deducted upfront)`],
                  ["You receive",          `${(amount - parseFloat(originationFee)).toFixed(2)} RLUSD`],
                  ["Installment",          `${installment.toFixed(4)} RLUSD`],
                  ["Installments",         `${PAYMENT_TOTAL}× every 5 min`],
                  ["Total to repay",       `${(installment * PAYMENT_TOTAL).toFixed(4)} RLUSD`],
                  ["Grace period",         "1 min / installment"],
                ].map(([k, v], i, arr) => (
                  <div
                    key={k}
                    className="flex items-center justify-between px-4 py-3"
                    style={{ borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none" }}
                  >
                    <span style={{ color: "rgba(241,245,249,0.4)", fontSize: "12.5px" }}>{k}</span>
                    <span style={{ color: "rgba(241,245,249,0.85)", fontSize: "13px", fontWeight: 500 }}>{v}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={confirmLoan}
                className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold"
                style={{ background: "linear-gradient(135deg,#00d4ff,#7c3aed)", color: "#fff" }}
              >
                Confirm loan
                <ArrowRight className="h-4 w-4" />
              </button>

              <Link href={returnUrl}>
                <button
                  className="w-full flex items-center justify-center gap-2 rounded-xl py-2 text-sm"
                  style={{ color: "rgba(241,245,249,0.35)", fontSize: "12px" }}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Cancel and return to shop
                </button>
              </Link>
            </div>
          )}

          {/* ── CONFIRMING ── */}
          {state === S.CONFIRMING && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#7c3aed" }} />
              <p style={{ color: "rgba(241,245,249,0.75)", fontSize: "13px", fontWeight: 500 }}>Sign with your wallet...</p>
              <p style={{ color: "rgba(241,245,249,0.35)", fontSize: "12px" }}>Broker pre-signed · Sign the LoanSet in Xaman to finalize</p>
            </div>
          )}

          {/* ── SUCCESS ── */}
          {state === S.SUCCESS && result && (
            <div className="space-y-5">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="h-5 w-5" style={{ color: "#10b981" }} />
                <span style={{ color: "#10b981", fontSize: "13px", fontWeight: 600 }}>Loan created successfully</span>
              </div>

              <div
                className="rounded-xl overflow-hidden"
                style={{ background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.2)" }}
              >
                {[
                  ["Product",           product],
                  ["Monthly payment",   `${result.periodicPayment} RLUSD`],
                  ["Next due date",      fmtDate(result.nextPaymentDueDate)],
                  ["Loan ID",           result.loanId],
                  ["Tx hash",           result.hash],
                ].map(([k, v], i, arr) => (
                  <div
                    key={k}
                    className="flex items-start justify-between px-4 py-3 gap-4"
                    style={{ borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none" }}
                  >
                    <span style={{ color: "rgba(241,245,249,0.4)", fontSize: "12.5px", flexShrink: 0 }}>{k}</span>
                    <span style={{ color: "rgba(241,245,249,0.8)", fontSize: "11.5px", fontFamily: "monospace", wordBreak: "break-all", textAlign: "right" }}>{v}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={() => router.push(`${returnUrl}?status=success&loanId=${result.loanId}`)}
                className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold"
                style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)", color: "#10b981" }}
              >
                Return to {merchant}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* ── ERROR ── */}
          {state === S.ERROR && (
            <div className="space-y-4">
              <div
                className="rounded-xl px-4 py-3"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
              >
                <p style={{ color: "#f87171", fontSize: "13px" }}>{error}</p>
              </div>
              <button
                onClick={() => { setState(S.READY); setError(null); }}
                className="w-full flex items-center justify-center rounded-xl py-2.5 text-sm"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(241,245,249,0.6)" }}
              >
                Try again
              </button>
            </div>
          )}

        </div>

        {/* Footer note */}
        <p className="text-center mt-6" style={{ color: "rgba(241,245,249,0.18)", fontSize: "11px" }}>
          edeLLand · XRPL
        </p>
      </div>
    </div>
  );
}

// ── Page wrapper (Suspense for useSearchParams) ────────────────────────────────

export default function CheckoutPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#08090e" }}>
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#00d4ff" }} />
      </div>
    }>
      <CheckoutInner />
    </Suspense>
  );
}
