"use client";

import { Suspense, useState, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { useWallet } from "../../components/providers/WalletProvider";
import { startVerification, watchVerification } from "../../scripts/edel-id/verification";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, ShieldCheck, Zap } from "lucide-react";

// ── States ────────────────────────────────────────────────────────────────────

const S = {
  IDLE:            0,
  EDEL_LOADING:    1,
  EDEL_WAITING:    2,
  EDEL_DONE:       3,
  INCOME_SELECT:   3.5, // full flow only
  ISSUING:         4,
  ISSUING_TIER:    4.5, // full flow only — issue KYC_TIERx after KYC_FULL
  ACCEPTING:       5,
  ACCEPTING_TIER:  5.5, // full flow only — accept KYC_TIERx after KYC_FULL
  DONE:            6,
  ERROR:           -1,
};

// ── Income brackets → KYC tier ────────────────────────────────────────────────

const INCOME_BRACKETS = [
  {
    id:        "tier0",
    label:     "< 1,500 CHF / month",
    tier:      "KYC_TIER0",
    maxCredit: 500,
    desc:      "Credit access up to 500 RLUSD",
  },
  {
    id:        "tier1",
    label:     "1,500 – 3,000 CHF / month",
    tier:      "KYC_TIER1",
    maxCredit: 1000,
    desc:      "Credit access up to 1,000 RLUSD",
  },
  {
    id:        "tier2",
    label:     "> 3,000 CHF / month",
    tier:      "KYC_TIER2",
    maxCredit: 2000,
    desc:      "Credit access up to 2,000 RLUSD",
  },
];

// ── Step indicator ────────────────────────────────────────────────────────────

function Step({ n, label, active, done }) {
  const color = done ? "#10b981" : active ? "#00d4ff" : "rgba(241,245,249,0.2)";
  return (
    <div className="flex items-center gap-3">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-bold transition-all duration-300"
        style={{
          background: done ? "rgba(16,185,129,0.15)" : active ? "rgba(0,212,255,0.12)" : "rgba(255,255,255,0.04)",
          border: `1.5px solid ${color}`,
          color,
        }}
      >
        {done ? <CheckCircle2 className="h-4 w-4" /> : n}
      </div>
      <span
        className="text-sm font-medium transition-colors duration-300"
        style={{ color: done ? "#10b981" : active ? "rgba(241,245,249,0.85)" : "rgba(241,245,249,0.3)" }}
      >
        {label}
      </span>
    </div>
  );
}

// ── KYC flow option button ────────────────────────────────────────────────────

function FlowOption({ title, badge, description, onClick, highlight }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-2xl p-5 transition-all duration-200"
      style={{
        background: highlight ? "rgba(0,212,255,0.06)" : "rgba(255,255,255,0.03)",
        border: highlight ? "1.5px solid rgba(0,212,255,0.3)" : "1.5px solid rgba(255,255,255,0.08)",
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-sm" style={{ color: "rgba(241,245,249,0.9)" }}>{title}</span>
        <span
          className="px-2 py-0.5 rounded-full text-xs font-semibold"
          style={{
            background: highlight ? "rgba(0,212,255,0.15)" : "rgba(255,255,255,0.07)",
            color: highlight ? "#00d4ff" : "rgba(241,245,249,0.5)",
            border: highlight ? "1px solid rgba(0,212,255,0.3)" : "1px solid rgba(255,255,255,0.1)",
          }}
        >
          {badge}
        </span>
      </div>
      <p style={{ color: "rgba(241,245,249,0.4)", fontSize: "12.5px", lineHeight: 1.6 }}>{description}</p>
    </button>
  );
}

// ── Divider ───────────────────────────────────────────────────────────────────

function StepDiv() {
  return <div style={{ height: "1px", background: "rgba(255,255,255,0.05)", margin: "2px 0 2px 16px" }} />;
}

// ── Inner page (uses useSearchParams) ─────────────────────────────────────────

function OnboardingInner() {
  const router                               = useRouter();
  const searchParams                         = useSearchParams();
  const { isConnected, accountInfo, walletManager } = useWallet();
  const signAndSubmit = useCallback((tx) => walletManager.signAndSubmit(tx), [walletManager]);

  const returnTo = searchParams.get("return") ?? null; // e.g. /checkout?...

  const [existingKyc,  setExistingKyc]  = useState("loading"); // "loading" | null | "KYC_OVER18" | "KYC_FULL"
  const [existingTier, setExistingTier] = useState(null);      // null | "KYC_TIER1" | "KYC_TIER2"
  const [flow,         setFlow]         = useState(null);
  const [step,         setStep]         = useState(S.IDLE);
  const [qrUrl,        setQrUrl]        = useState(null);
  const [claims,       setClaims]       = useState(null);
  const [incomeBracket, setIncomeBracket] = useState(null); // selected bracket id
  const [hashes,       setHashes]       = useState({ create: null, createTier: null, accept: null, acceptTier: null });
  const [error,        setError]        = useState(null);
  const [amlBlock,     setAmlBlock]     = useState(null); // { label, source } when AML-blocked
  const [issuedTier,   setIssuedTier]   = useState(null); // { issuer, credentialType }
  const [ofacStatus,   setOfacStatus]   = useState("idle");   // "idle" | "checking" | "blocked" | "clear"
  const [ofacInfo,     setOfacInfo]     = useState(null);     // { label, source } when blocked
  const [revokeStatus, setRevokeStatus] = useState("idle");   // "idle" | "revoking" | "done" | "failed"

  const address = accountInfo?.address;

  // ── Load existing credentials on mount ────────────────────────────────────

  useEffect(() => {
    if (!address) { setExistingKyc(null); return; }
    setExistingKyc("loading");
    fetch(`/api/account/credential?address=${encodeURIComponent(address)}`)
      .then(r => r.json())
      .then(d => {
        const accepted = new Set(
          (d.credentials ?? []).filter(c => c.accepted).map(c => c.credentialTypeLabel)
        );
        if (accepted.has("KYC_FULL"))        setExistingKyc("KYC_FULL");
        else if (accepted.has("KYC_OVER18")) setExistingKyc("KYC_OVER18");
        else                                 setExistingKyc(null);
        if (accepted.has("KYC_TIER2"))      setExistingTier("KYC_TIER2");
        else if (accepted.has("KYC_TIER1")) setExistingTier("KYC_TIER1");
        else if (accepted.has("KYC_TIER0")) setExistingTier("KYC_TIER0");
      })
      .catch(() => setExistingKyc(null));
  }, [address]);

  // ── OFAC / AML check on mount — runs as soon as address is known ──────────

  useEffect(() => {
    if (!address) return;
    setOfacStatus("checking");
    fetch(`/api/ofac/check?address=${encodeURIComponent(address)}`)
      .then(r => r.json())
      .then(data => {
        if (data.blocked) {
          setOfacInfo({ label: data.label, source: data.source });
          setOfacStatus("blocked");
          // Auto-revoke all platform credentials
          setRevokeStatus("revoking");
          fetch("/api/credential/revoke", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ subjectAddress: address }),
          })
            .then(r => r.json())
            .then(d => setRevokeStatus(d.allOk || d.revoked?.length === 0 ? "done" : "failed"))
            .catch(() => setRevokeStatus("failed"));
        } else {
          setOfacStatus("clear");
        }
      })
      .catch(() => setOfacStatus("clear")); // fail open — don't block on API error
  }, [address]);

  // ── Tier-only update (skip Edel-ID, go straight to income selection) ──────

  const startTierUpdate = useCallback(() => {
    setFlow("full");
    setStep(S.INCOME_SELECT);
    setError(null);
    setIncomeBracket(null);
  }, []);

  // ── DEV bypass ────────────────────────────────────────────────────────────

  const bypassEdel = useCallback((selectedFlow) => {
    setFlow(selectedFlow);
    setClaims({ given_name: "Dev", family_name: "User", nationality: "CH", age_over_18: "true" });
    setStep(selectedFlow === "full" ? S.INCOME_SELECT : S.EDEL_DONE);
  }, []);

  // ── Step 1 — Edel-ID ──────────────────────────────────────────────────────

  const startEdel = useCallback(async (selectedFlow) => {
    setFlow(selectedFlow);
    setStep(S.EDEL_LOADING);
    setError(null);
    try {
      const { id, verification_url } = await startVerification(selectedFlow, address);
      const qr = await QRCode.toDataURL(verification_url, { width: 220, margin: 2, color: { dark: "#0d0e16", light: "#f1f5f9" } });
      setQrUrl(qr);
      setStep(S.EDEL_WAITING);
      const result = await watchVerification(id, () => {}, selectedFlow);
      if (result.state !== "SUCCESS") throw new Error("Verification failed or was rejected.");
      const merged = Object.assign({}, ...(result.verifiedClaims ?? []));
      setClaims(merged);
      setQrUrl(null);
      // Full flow → income selection; minimal → straight to issue
      setStep(selectedFlow === "full" ? S.INCOME_SELECT : S.EDEL_DONE);
    } catch (err) {
      setQrUrl(null);
      if (err.amlBlocked) {
        setAmlBlock({ label: err.amlLabel, source: err.amlSource });
      } else {
        setError(err.message);
      }
      setStep(S.ERROR);
    }
  }, [address]);

  // ── Steps 2–5 — Issue + Accept ────────────────────────────────────────────

  const issueAndAccept = useCallback(async (bracket) => {
    if (!address) { setError("No wallet connected."); setStep(S.ERROR); return; }
    if (!walletManager) { setError("Wallet manager not ready."); setStep(S.ERROR); return; }
    setError(null);

    const isFull = flow === "full";
    const mainCredType = isFull ? "KYC_FULL" : "KYC_OVER18";
    const tierCredType = bracket?.tier ?? null; // e.g. "KYC_TIER2"

    // ── Fetch already-accepted credentials ──────────────────────────────────
    let acceptedTypes = new Set();
    try {
      const r = await fetch(`/api/account/credential?address=${encodeURIComponent(address)}`);
      const d = await r.json();
      acceptedTypes = new Set(
        (d.credentials ?? []).filter(c => c.accepted).map(c => c.credentialTypeLabel)
      );
    } catch { /* non-fatal — proceed without skipping */ }

    const mainAlreadyAccepted = acceptedTypes.has(mainCredType);
    const tierAlreadyAccepted = tierCredType ? acceptedTypes.has(tierCredType) : false;

    // ── Issue KYC_FULL / KYC_OVER18 (skip if already accepted) ─────────────
    setStep(S.ISSUING);
    let mainIssuer, mainCredHex, mainHash;
    try {
      const res  = await fetch("/api/credential/issue", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ subjectAddress: address, credentialType: mainCredType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "CredentialCreate failed");
      mainIssuer  = data.issuer;
      mainCredHex = data.credentialType;
      mainHash    = data.txHash;
      setHashes(h => ({ ...h, create: mainHash }));
    } catch (err) {
      setError(err.message);
      setStep(S.ERROR);
      return;
    }

    // ── Issue KYC_TIERx (full flow only, skip if already accepted) ──────────
    let tierIssuer, tierCredHex, tierHash;
    if (isFull && tierCredType) {
      setStep(S.ISSUING_TIER);
      try {
        const res  = await fetch("/api/credential/issue", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ subjectAddress: address, credentialType: tierCredType }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "CredentialCreate (tier) failed");
        tierIssuer  = data.issuer;
        tierCredHex = data.credentialType;
        tierHash    = data.txHash;
        setHashes(h => ({ ...h, createTier: tierHash }));
        setIssuedTier({ issuer: tierIssuer, credentialType: tierCredHex });
      } catch (err) {
        setError(err.message);
        setStep(S.ERROR);
        return;
      }
    }

    // ── Accept KYC_FULL / KYC_OVER18 (skip if already accepted on-chain) ────
    if (mainAlreadyAccepted) {
      setHashes(h => ({ ...h, accept: "already-accepted" }));
    } else {
      setStep(S.ACCEPTING);
      try {
        const result = await signAndSubmit({
          TransactionType: "CredentialAccept",
          Account:         address,
          Issuer:          mainIssuer,
          CredentialType:  mainCredHex,
        });
        setHashes(h => ({ ...h, accept: result.hash ?? result.id ?? "submitted" }));
      } catch (err) {
        setError(err.message);
        setStep(S.ERROR);
        return;
      }
    }

    // ── Accept KYC_TIERx (full flow only, skip if already accepted on-chain) ─
    if (isFull && tierIssuer && tierCredHex) {
      if (tierAlreadyAccepted) {
        setHashes(h => ({ ...h, acceptTier: "already-accepted" }));
      } else {
        setStep(S.ACCEPTING_TIER);
        try {
          const result = await signAndSubmit({
            TransactionType: "CredentialAccept",
            Account:         address,
            Issuer:          tierIssuer,
            CredentialType:  tierCredHex,
          });
          setHashes(h => ({ ...h, acceptTier: result.hash ?? result.id ?? "submitted" }));
        } catch (err) {
          setError(err.message);
          setStep(S.ERROR);
          return;
        }
      }
    }

    setStep(S.DONE);
  }, [address, signAndSubmit, flow, walletManager]);

  // ── Stepper config ────────────────────────────────────────────────────────

  const isFull     = flow === "full";
  const edelDone   = step >= S.EDEL_DONE || step === S.INCOME_SELECT;
  const incomeDone = step > S.INCOME_SELECT;
  const createDone = step >= S.ACCEPTING;
  const acceptDone = step === S.DONE;

  // ── Not connected ─────────────────────────────────────────────────────────

  if (isConnected && ofacStatus === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="glass rounded-2xl p-10 text-center max-w-sm mx-4">
          <Loader2 className="h-7 w-7 animate-spin mx-auto mb-4" style={{ color: "#00d4ff" }} />
          <p style={{ color: "rgba(241,245,249,0.5)", fontSize: "13px" }}>Screening wallet address…</p>
        </div>
      </div>
    );
  }

  if (isConnected && ofacStatus === "blocked") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div
          className="w-full max-w-lg rounded-2xl p-8 space-y-6"
          style={{
            background: "rgba(239,68,68,0.08)",
            border: "2px solid rgba(239,68,68,0.55)",
          }}
        >
          {/* Icon + title */}
          <div className="flex flex-col items-center gap-4 text-center">
            <div
              className="flex h-16 w-16 items-center justify-center rounded-2xl"
              style={{ background: "rgba(239,68,68,0.15)", border: "1.5px solid rgba(239,68,68,0.4)" }}
            >
              <AlertTriangle className="h-8 w-8" style={{ color: "#ef4444" }} />
            </div>
            <div>
              <h2 className="text-xl font-bold" style={{ color: "#f87171" }}>
                Access Denied — OFAC / AML Sanction
              </h2>
              <p className="mt-1" style={{ color: "rgba(248,113,113,0.7)", fontSize: "13px", lineHeight: 1.6 }}>
                This wallet address appears on the sanctions list. KYC onboarding is not available.
              </p>
            </div>
          </div>

          {/* Sanction details */}
          {ofacInfo?.label && (
            <div
              className="rounded-xl px-4 py-3 space-y-1"
              style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.25)" }}
            >
              <p style={{ color: "rgba(241,245,249,0.35)", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
                {ofacInfo.source ?? "OFAC"}
              </p>
              <p style={{ color: "rgba(241,245,249,0.6)", fontSize: "12.5px", fontFamily: "monospace" }}>
                {ofacInfo.label}
              </p>
            </div>
          )}

          {/* Address */}
          <div
            className="rounded-xl px-4 py-3"
            style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <p style={{ color: "rgba(241,245,249,0.3)", fontSize: "11px", marginBottom: "4px" }}>Wallet address</p>
            <code style={{ color: "rgba(241,245,249,0.55)", fontSize: "11.5px", fontFamily: "monospace", wordBreak: "break-all" }}>
              {address}
            </code>
          </div>

          {/* Revocation status */}
          <div
            className="rounded-xl px-4 py-3 flex items-center gap-3"
            style={{
              background: revokeStatus === "done" ? "rgba(239,68,68,0.06)" : "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            {revokeStatus === "revoking" && <Loader2 className="h-4 w-4 shrink-0 animate-spin" style={{ color: "#f87171" }} />}
            {revokeStatus === "done"     && <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: "#f87171" }} />}
            {revokeStatus === "failed"   && <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: "#fb923c" }} />}
            <p style={{ fontSize: "12px", color: "rgba(241,245,249,0.4)" }}>
              {revokeStatus === "idle"     && "Checking issued credentials…"}
              {revokeStatus === "revoking" && "Revoking platform credentials…"}
              {revokeStatus === "done"     && "All platform credentials have been revoked."}
              {revokeStatus === "failed"   && "Credential revocation encountered an error — contact support."}
            </p>
          </div>

          <p style={{ color: "rgba(241,245,249,0.25)", fontSize: "11.5px", textAlign: "center", lineHeight: 1.6 }}>
            If you believe this is an error, please contact support with your wallet address.
          </p>
        </div>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="glass rounded-2xl p-10 text-center max-w-sm mx-4">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl mx-auto mb-5"
            style={{ background: "rgba(0,212,255,0.1)", border: "1px solid rgba(0,212,255,0.2)" }}
          >
            <ShieldCheck className="h-7 w-7" style={{ color: "#00d4ff" }} />
          </div>
          <p className="font-semibold mb-2" style={{ color: "rgba(241,245,249,0.9)" }}>Wallet not connected</p>
          <p style={{ color: "rgba(241,245,249,0.4)", fontSize: "13px", lineHeight: 1.6 }}>
            Connect your Otsu Wallet first to start KYC onboarding.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1">
        <div className="container py-10 max-w-lg">

          {/* Page header */}
          <div className="flex items-center gap-3 mb-8">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: "rgba(0,212,255,0.12)", border: "1px solid rgba(0,212,255,0.22)" }}
            >
              <ShieldCheck className="h-[18px] w-[18px]" style={{ color: "#00d4ff" }} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: "rgba(241,245,249,0.92)" }}>
                KYC Onboarding
              </h1>
              <p style={{ color: "rgba(241,245,249,0.38)", fontSize: "13px" }}>
                Verify your identity to access the platform
              </p>
            </div>
          </div>

          {/* Stepper */}
          {flow && (
            <div
              className="flex flex-col gap-3 p-5 rounded-2xl mb-6"
              style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              <Step n={1} label="Verify identity with Edel-ID"         active={step < S.EDEL_DONE && step !== S.INCOME_SELECT} done={edelDone} />
              {isFull && (
                <>
                  <StepDiv />
                  <Step n={2} label="Income assessment (KYC_TIER)"       active={step === S.INCOME_SELECT} done={incomeDone} />
                  <StepDiv />
                  <Step n={3} label="Issue credentials (platform)"       active={step === S.ISSUING || step === S.ISSUING_TIER} done={createDone} />
                  <StepDiv />
                  <Step n={4} label="Accept credentials (your wallet)"   active={step === S.ACCEPTING || step === S.ACCEPTING_TIER} done={acceptDone} />
                </>
              )}
              {!isFull && (
                <>
                  <StepDiv />
                  <Step n={2} label="Issue credential (platform signature)" active={step === S.ISSUING}   done={createDone} />
                  <StepDiv />
                  <Step n={3} label="Accept credential (your wallet)"       active={step === S.ACCEPTING} done={acceptDone} />
                </>
              )}
            </div>
          )}

          {/* Main card */}
          <div className="glass rounded-2xl p-6 space-y-5">

            {/* ── Flow selection ── */}
            {step === S.IDLE && (
              <div className="space-y-4">
                <div
                  className="flex items-center justify-between rounded-xl px-4 py-3"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  <span style={{ color: "rgba(241,245,249,0.4)", fontSize: "12px" }}>Wallet</span>
                  <code style={{ fontSize: "11px", fontFamily: "monospace", color: "rgba(241,245,249,0.65)" }}>{address}</code>
                </div>

                {existingKyc === "loading" && (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin" style={{ color: "#00d4ff" }} />
                  </div>
                )}

                {existingKyc === "KYC_FULL" && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="status-dot status-dot-green" />
                      <span style={{ color: "#10b981", fontSize: "13px", fontWeight: 600 }}>Full KYC verified</span>
                      <span
                        className="px-2 py-0.5 rounded-full text-xs font-semibold"
                        style={{ background: "rgba(16,185,129,0.12)", color: "#10b981", border: "1px solid rgba(16,185,129,0.25)" }}
                      >
                        KYC_FULL
                      </span>
                      {existingTier && (
                        <span
                          className="px-2 py-0.5 rounded-full text-xs font-semibold"
                          style={{ background: "rgba(0,212,255,0.12)", color: "#00d4ff", border: "1px solid rgba(0,212,255,0.25)" }}
                        >
                          {existingTier}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => router.push(returnTo ?? "/account")}
                      className="btn-gradient w-full justify-center"
                      style={{ borderRadius: "12px" }}
                    >
                      {returnTo ? "Continue to payment" : "Back to My Account"}
                      <ArrowRight className="h-4 w-4" />
                    </button>
                    <button
                      onClick={startTierUpdate}
                      className="btn-ghost w-full justify-center"
                      style={{ borderRadius: "12px", fontSize: "12.5px" }}
                    >
                      Update my credit tier (income reassessment)
                    </button>
                  </div>
                )}

                {(existingKyc === null || existingKyc === "KYC_OVER18") && (
                  <>
                    <p style={{ color: "rgba(241,245,249,0.45)", fontSize: "13px" }}>
                      {existingKyc === "KYC_OVER18" ? "Upgrade your KYC level:" : "Choose your KYC level:"}
                    </p>
                    <div className="flex flex-col gap-3">
                      <FlowOption
                        title="Full KYC"
                        badge="KYC_FULL + KYC_TIER"
                        description="Verifies your name, nationality and age (18+). Includes income-based credit tier for buy-now-pay-later. Required for full platform access."
                        onClick={() => startEdel("full")}
                        highlight
                      />
                      {existingKyc === null && (
                        <FlowOption
                          title="Minimal KYC"
                          badge="KYC_OVER18"
                          description="Verifies only that you are 18+ and your country. Faster, with limited access. Upgradeable to Full KYC later."
                          onClick={() => startEdel("minimal")}
                          highlight={false}
                        />
                      )}
                    </div>
                  </>
                )}
                {process.env.NODE_ENV === "development" && (
                  <div
                    className="rounded-2xl p-1 mt-1"
                    style={{ border: "1px dashed rgba(251,191,36,0.3)", background: "rgba(251,191,36,0.04)" }}
                  >
                    <div className="flex items-center justify-between px-3 py-1.5 mb-1">
                      <span style={{ color: "rgba(251,191,36,0.6)", fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                        Dev only
                      </span>
                    </div>
                    <div className="flex flex-col gap-1.5 px-2 pb-2">
                      <button
                        onClick={() => bypassEdel("full")}
                        className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold transition-all"
                        style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.25)", color: "rgba(251,191,36,0.9)" }}
                      >
                        <Zap className="h-3.5 w-3.5" />
                        Bypass Edel-ID — Full KYC
                      </button>
                      <button
                        onClick={() => bypassEdel("minimal")}
                        className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold transition-all"
                        style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.15)", color: "rgba(251,191,36,0.6)" }}
                      >
                        <Zap className="h-3.5 w-3.5" />
                        Bypass Edel-ID — Minimal KYC
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Edel loading ── */}
            {step === S.EDEL_LOADING && (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#00d4ff" }} />
                <p style={{ color: "rgba(241,245,249,0.5)", fontSize: "13px" }}>Connecting to Edel-ID…</p>
              </div>
            )}

            {/* ── QR ── */}
            {step === S.EDEL_WAITING && qrUrl && (
              <div className="flex flex-col items-center gap-5">
                <p style={{ color: "rgba(241,245,249,0.55)", fontSize: "13px", textAlign: "center" }}>
                  Scan with the <strong style={{ color: "rgba(241,245,249,0.85)" }}>Edel-ID</strong> app
                </p>
                <div className="rounded-2xl overflow-hidden p-4" style={{ background: "#f1f5f9" }}>
                  <img src={qrUrl} alt="Edel-ID QR" style={{ width: "200px", height: "200px", display: "block" }} />
                </div>
                <div className="flex items-center gap-2" style={{ color: "rgba(241,245,249,0.35)", fontSize: "12px" }}>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Waiting for confirmation…
                </div>
              </div>
            )}

            {/* ── Edel done (minimal) — show claims + issue button ── */}
            {step === S.EDEL_DONE && claims && (
              <div className="space-y-5">
                <div className="flex items-center gap-2.5">
                  <span className="status-dot status-dot-green" />
                  <span style={{ color: "#10b981", fontSize: "13px", fontWeight: 600 }}>Identity verified</span>
                  <span
                    className="px-2 py-0.5 rounded-full text-xs font-semibold"
                    style={{ background: "rgba(0,212,255,0.12)", color: "#00d4ff", border: "1px solid rgba(0,212,255,0.25)" }}
                  >
                    KYC_OVER18
                  </span>
                </div>
                <div
                  className="rounded-xl overflow-hidden"
                  style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  {[
                    claims.given_name   && { label: "First name",  value: claims.given_name },
                    claims.family_name  && { label: "Last name",   value: claims.family_name },
                    claims.nationality  && { label: "Nationality", value: claims.nationality },
                    claims.age_over_18 !== undefined && {
                      label: "Age 18+",
                      value: <span style={{ color: claims.age_over_18 === "true" ? "#10b981" : "#f87171", fontWeight: 600 }}>{claims.age_over_18 === "true" ? "Yes ✓" : "No"}</span>,
                    },
                  ].filter(Boolean).map((row, i, arr) => (
                    <div
                      key={row.label}
                      className="flex items-center justify-between px-4 py-3"
                      style={{ borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none" }}
                    >
                      <span style={{ color: "rgba(241,245,249,0.4)", fontSize: "12.5px" }}>{row.label}</span>
                      <span style={{ color: "rgba(241,245,249,0.85)", fontSize: "13px" }}>{row.value}</span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => issueAndAccept(null)}
                  className="btn-gradient w-full justify-center"
                  style={{ borderRadius: "12px", fontSize: "13.5px" }}
                >
                  Issue &amp; Accept Credential on XRPL <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* ── Income selection (full flow) ── */}
            {step === S.INCOME_SELECT && (
              <div className="space-y-5">
                <div className="flex items-center gap-2.5">
                  <span className="status-dot status-dot-green" />
                  <span style={{ color: "#10b981", fontSize: "13px", fontWeight: 600 }}>Identity verified</span>
                  <span
                    className="px-2 py-0.5 rounded-full text-xs font-semibold"
                    style={{ background: "rgba(0,212,255,0.12)", color: "#00d4ff", border: "1px solid rgba(0,212,255,0.25)" }}
                  >
                    KYC_FULL
                  </span>
                </div>

                <div>
                  <p className="font-semibold text-sm mb-1" style={{ color: "rgba(241,245,249,0.85)" }}>
                    What is your monthly net income?
                  </p>
                  <p style={{ color: "rgba(241,245,249,0.38)", fontSize: "12px", lineHeight: 1.6 }}>
                    This determines your credit tier (KYC_TIER) recorded on-chain.
                    It is not shared with Edel-ID.
                  </p>
                </div>

                <div className="flex flex-col gap-2.5">
                  {INCOME_BRACKETS.map((b) => {
                    const selected  = incomeBracket === b.id;
                    const isCurrent = existingTier === b.tier;
                    return (
                      <button
                        key={b.id}
                        onClick={() => setIncomeBracket(b.id)}
                        className="w-full text-left rounded-2xl p-4 transition-all duration-150"
                        style={{
                          background: selected ? "rgba(0,212,255,0.07)" : "rgba(255,255,255,0.025)",
                          border: selected ? "1.5px solid rgba(0,212,255,0.35)" : "1.5px solid rgba(255,255,255,0.07)",
                        }}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-sm" style={{ color: selected ? "rgba(241,245,249,0.95)" : "rgba(241,245,249,0.7)" }}>
                            {b.label}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {isCurrent && (
                              <span
                                className="px-2 py-0.5 rounded-full text-xs font-semibold"
                                style={{ background: "rgba(16,185,129,0.12)", color: "#10b981", border: "1px solid rgba(16,185,129,0.25)" }}
                              >
                                Current
                              </span>
                            )}
                            <span
                              className="px-2 py-0.5 rounded-full text-xs font-semibold"
                              style={{
                                background: selected ? "rgba(0,212,255,0.15)" : "rgba(255,255,255,0.06)",
                                color: selected ? "#00d4ff" : "rgba(241,245,249,0.4)",
                                border: selected ? "1px solid rgba(0,212,255,0.3)" : "1px solid rgba(255,255,255,0.08)",
                              }}
                            >
                              {b.tier}
                            </span>
                          </div>
                        </div>
                        <p style={{ color: "rgba(241,245,249,0.38)", fontSize: "12px" }}>{b.desc}</p>
                      </button>
                    );
                  })}
                </div>

                {(() => {
                  const selectedBracket = INCOME_BRACKETS.find(b => b.id === incomeBracket);
                  const sameAsCurrent   = selectedBracket && existingTier && selectedBracket.tier === existingTier;
                  const canProceed      = incomeBracket && !sameAsCurrent;
                  return (
                    <>
                      {sameAsCurrent && (
                        <p style={{ color: "rgba(241,245,249,0.35)", fontSize: "12px", textAlign: "center" }}>
                          You already have {existingTier}. Select a different bracket to update.
                        </p>
                      )}
                      <button
                        disabled={!canProceed}
                        onClick={() => issueAndAccept(selectedBracket)}
                        className="btn-gradient w-full justify-center"
                        style={{
                          borderRadius: "12px",
                          fontSize: "13.5px",
                          opacity: canProceed ? 1 : 0.4,
                          cursor: canProceed ? "pointer" : "not-allowed",
                        }}
                      >
                        Issue &amp; Accept Credentials on XRPL <ArrowRight className="h-4 w-4" />
                      </button>
                    </>
                  );
                })()}
              </div>
            )}

            {/* ── CredentialCreate in flight ── */}
            {step === S.ISSUING && (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#7c3aed" }} />
                <p style={{ color: "rgba(241,245,249,0.75)", fontSize: "13px", fontWeight: 500 }}>Submitting CredentialCreate…</p>
                <p style={{ color: "rgba(241,245,249,0.35)", fontSize: "12px" }}>
                  {flow === "full" ? "Issuing KYC_FULL" : "Issuing KYC_OVER18"}
                </p>
              </div>
            )}

            {/* ── Issuing KYC_TIER ── */}
            {step === S.ISSUING_TIER && (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#7c3aed" }} />
                <p style={{ color: "rgba(241,245,249,0.75)", fontSize: "13px", fontWeight: 500 }}>Issuing credit tier credential…</p>
                <p style={{ color: "rgba(241,245,249,0.35)", fontSize: "12px" }}>
                  {INCOME_BRACKETS.find(b => b.id === incomeBracket)?.tier ?? "KYC_TIER"}
                </p>
              </div>
            )}

            {/* ── CredentialAccept in flight ── */}
            {step === S.ACCEPTING && (
              <div className="space-y-4">
                {hashes.create && (
                  <div
                    className="rounded-xl px-4 py-3 text-xs font-mono break-all"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(241,245,249,0.5)" }}
                  >
                    <span style={{ color: "rgba(241,245,249,0.3)", fontFamily: "sans-serif", fontSize: "11px" }}>CredentialCreate </span>
                    {hashes.create}
                  </div>
                )}
                <div className="flex flex-col items-center gap-3 py-4">
                  <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#00d4ff" }} />
                  <p style={{ color: "rgba(241,245,249,0.75)", fontSize: "13px", fontWeight: 500 }}>Waiting for wallet signature…</p>
                  <p style={{ color: "rgba(241,245,249,0.35)", fontSize: "12px" }}>
                    Approve the CredentialAccept ({flow === "full" ? "KYC_FULL" : "KYC_OVER18"}) in your Otsu Wallet
                  </p>
                </div>
              </div>
            )}

            {/* ── Accepting KYC_TIER ── */}
            {step === S.ACCEPTING_TIER && (
              <div className="space-y-4">
                {hashes.createTier && (
                  <div
                    className="rounded-xl px-4 py-3 text-xs font-mono break-all"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(241,245,249,0.5)" }}
                  >
                    <span style={{ color: "rgba(241,245,249,0.3)", fontFamily: "sans-serif", fontSize: "11px" }}>CredentialCreate (tier) </span>
                    {hashes.createTier}
                  </div>
                )}
                <div className="flex flex-col items-center gap-3 py-4">
                  <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#00d4ff" }} />
                  <p style={{ color: "rgba(241,245,249,0.75)", fontSize: "13px", fontWeight: 500 }}>Waiting for wallet signature…</p>
                  <p style={{ color: "rgba(241,245,249,0.35)", fontSize: "12px" }}>
                    Approve the CredentialAccept ({INCOME_BRACKETS.find(b => b.id === incomeBracket)?.tier ?? "KYC_TIER"}) in your Otsu Wallet
                  </p>
                </div>
              </div>
            )}

            {/* ── Done ── */}
            {step === S.DONE && (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="status-dot status-dot-green" />
                  <span style={{ color: "#10b981", fontSize: "13px", fontWeight: 600 }}>Credential(s) issued &amp; accepted</span>
                  <span
                    className="px-2 py-0.5 rounded-full text-xs font-semibold"
                    style={{ background: "rgba(16,185,129,0.12)", color: "#10b981", border: "1px solid rgba(16,185,129,0.25)" }}
                  >
                    {flow === "minimal" ? "KYC_OVER18" : "KYC_FULL"}
                  </span>
                  {flow === "full" && incomeBracket && (
                    <span
                      className="px-2 py-0.5 rounded-full text-xs font-semibold"
                      style={{ background: "rgba(0,212,255,0.12)", color: "#00d4ff", border: "1px solid rgba(0,212,255,0.25)" }}
                    >
                      {INCOME_BRACKETS.find(b => b.id === incomeBracket)?.tier}
                    </span>
                  )}
                </div>
                <div
                  className="rounded-xl overflow-hidden"
                  style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  {[
                    hashes.create     && ["CredentialCreate",       hashes.create],
                    hashes.createTier && ["CredentialCreate (tier)", hashes.createTier],
                    hashes.accept     && ["CredentialAccept",        hashes.accept],
                    hashes.acceptTier && ["CredentialAccept (tier)", hashes.acceptTier],
                  ].filter(Boolean).map(([label, hash], i, arr) => (
                    <div
                      key={label}
                      className="px-4 py-3 text-xs font-mono break-all"
                      style={{ borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none", color: "rgba(241,245,249,0.5)" }}
                    >
                      <span style={{ color: "rgba(241,245,249,0.3)", fontFamily: "sans-serif" }}>{label} </span>
                      {hash}
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => router.push(returnTo ?? "/account")}
                  className="btn-gradient w-full justify-center"
                  style={{ borderRadius: "12px" }}
                >
                  {returnTo ? "Continue to payment" : "Back to My Account"}
                  <ArrowRight className="h-4 w-4" />
                </button>
                {returnTo && (
                  <button
                    onClick={() => router.push("/account")}
                    className="btn-ghost w-full justify-center"
                    style={{ borderRadius: "12px", fontSize: "12px" }}
                  >
                    Go to my account
                  </button>
                )}
              </div>
            )}

            {/* ── Error ── */}
            {step === S.ERROR && (
              <div className="space-y-4">
                {amlBlock ? (
                  <div
                    className="rounded-xl px-4 py-4 space-y-2"
                    style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.35)" }}
                  >
                    <p style={{ color: "#f87171", fontSize: "13px", fontWeight: 600 }}>
                      Access denied — AML / OFAC sanction
                    </p>
                    <p style={{ color: "rgba(248,113,113,0.8)", fontSize: "12px" }}>
                      This wallet address is on the sanctions list and cannot proceed with KYC.
                    </p>
                    {amlBlock.label && (
                      <p style={{ color: "rgba(241,245,249,0.4)", fontSize: "11px", fontFamily: "monospace" }}>
                        {amlBlock.source}: {amlBlock.label}
                      </p>
                    )}
                    <p style={{ color: "rgba(241,245,249,0.35)", fontSize: "11px" }}>
                      If you believe this is an error, contact support.
                    </p>
                  </div>
                ) : (
                  <div
                    className="rounded-xl px-4 py-3"
                    style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
                  >
                    <p style={{ color: "#f87171", fontSize: "13px" }}>{error}</p>
                  </div>
                )}
                {!amlBlock && (
                  <button
                    className="btn-ghost w-full justify-center"
                    style={{ borderRadius: "12px" }}
                    onClick={() => { setStep(S.IDLE); setFlow(null); setError(null); setAmlBlock(null); setIncomeBracket(null); }}
                  >
                    Try again
                  </button>
                )}
              </div>
            )}

          </div>
        </div>
      </main>

      <footer style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "20px 0", marginTop: "auto" }}>
        <div className="container text-center" style={{ color: "rgba(241,245,249,0.22)", fontSize: "12px" }}>
          edeLLand · Permissioned lending on XRPL
        </div>
      </footer>
    </div>
  );
}

// ── Page wrapper (Suspense for useSearchParams) ────────────────────────────────

export default function OnboardingPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#00d4ff" }} />
      </div>
    }>
      <OnboardingInner />
    </Suspense>
  );
}
