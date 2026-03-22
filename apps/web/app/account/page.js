"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "../../components/providers/WalletProvider";
import { ArrowRight, ShieldCheck, User } from "lucide-react";

// ── KYC credential hook ────────────────────────────────────────────────────────

function useKycCredentials(address) {
  const [data, setData]   = useState(undefined);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!address) { setData(null); return; }
    setData(undefined);
    fetch(`/api/account/credential?address=${encodeURIComponent(address)}`)
      .then(r => r.json())
      .then(json => {
        if (json.error) throw new Error(json.error);
        const accepted = (json.credentials ?? []).filter(c => c.accepted);
        const full     = accepted.find(c => c.credentialTypeLabel === "KYC_FULL");
        const over18   = accepted.find(c => c.credentialTypeLabel === "KYC_OVER18");
        setData({ full, over18 });
      })
      .catch(err => { setError(err.message); setData(null); });
  }, [address]);

  return { data, loading: data === undefined, error };
}

// ── Info row ──────────────────────────────────────────────────────────────────

function InfoRow({ label, value, last }) {
  return (
    <div
      className="flex items-center justify-between py-3.5"
      style={{ borderBottom: last ? "none" : "1px solid rgba(255,255,255,0.06)" }}
    >
      <span style={{ color: "rgba(241,245,249,0.4)", fontSize: "13px" }}>{label}</span>
      <span style={{ color: "rgba(241,245,249,0.85)", fontSize: "13px" }}>{value}</span>
    </div>
  );
}

// ── KYC Status ────────────────────────────────────────────────────────────────

function KycStatusBox({ address }) {
  const { data, loading, error } = useKycCredentials(address);

  const hasFull   = !!data?.full;
  const hasOver18 = !!data?.over18;
  const hasAny    = hasFull || hasOver18;
  const cred      = data?.full ?? data?.over18 ?? null;

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center gap-3 mb-5">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-xl"
          style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.22)" }}
        >
          <ShieldCheck className="h-[18px] w-[18px]" style={{ color: "#10b981" }} />
        </div>
        <h2 className="font-semibold" style={{ color: "rgba(241,245,249,0.9)", fontSize: "14px" }}>
          KYC / Identity
        </h2>
        {loading && (
          <span style={{ color: "rgba(241,245,249,0.3)", fontSize: "12px", marginLeft: "auto" }} className="animate-pulse">
            Checking…
          </span>
        )}
      </div>

      {!loading && !error && hasAny && (
        <div className="space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="status-dot status-dot-green" />
            <span style={{ color: "#10b981", fontSize: "13px", fontWeight: 600 }}>Verified</span>
            <span
              className="px-2 py-0.5 rounded-full text-xs font-semibold"
              style={{
                background: hasFull ? "rgba(0,212,255,0.12)" : "rgba(255,255,255,0.06)",
                color: hasFull ? "#00d4ff" : "rgba(241,245,249,0.5)",
                border: hasFull ? "1px solid rgba(0,212,255,0.25)" : "1px solid rgba(255,255,255,0.1)",
              }}
            >
              {hasFull ? "KYC_FULL" : "KYC_OVER18"}
            </span>
          </div>

          <div className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <InfoRow label="Issued by" value={<code style={{ fontSize: "11px", fontFamily: "monospace", color: "rgba(241,245,249,0.6)", wordBreak: "break-all" }}>{cred.issuer}</code>} />
            <InfoRow label="Credential type" value={<code style={{ fontSize: "12px", fontFamily: "monospace", color: "#00d4ff" }}>{cred.credentialTypeLabel}</code>} last />
          </div>

          {hasOver18 && !hasFull && (
            <div className="pt-1 space-y-3">
              <p style={{ color: "rgba(241,245,249,0.4)", fontSize: "12.5px", lineHeight: 1.6 }}>
                You have minimal KYC. Upgrade to Full KYC to unlock all platform features.
              </p>
              <Link href="/onboarding" className="btn-gradient w-full justify-center" style={{ borderRadius: "12px" }}>
                Upgrade to Full KYC <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}
        </div>
      )}

      {!loading && !error && !hasAny && (
        <div className="space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="status-dot status-dot-amber" />
            <span style={{ color: "rgba(241,245,249,0.45)", fontSize: "13px" }}>No credential on this address</span>
          </div>
          <Link href="/onboarding" className="btn-gradient w-full justify-center" style={{ borderRadius: "12px" }}>
            Start KYC Onboarding <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {!loading && error && (
        <p style={{ color: "#f87171", fontSize: "12px" }}>{error}</p>
      )}
    </div>
  );
}


// ── Page ──────────────────────────────────────────────────────────────────────

export default function AccountPage() {
  const { isConnected, accountInfo } = useWallet();

  if (!isConnected || !accountInfo) return null;

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1">
        <div className="container py-10 max-w-xl">

          {/* Page header */}
          <div className="flex items-center gap-3 mb-8">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: "rgba(241,245,249,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
            >
              <User className="h-[18px] w-[18px]" style={{ color: "rgba(241,245,249,0.6)" }} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: "rgba(241,245,249,0.92)" }}>
                My Account
              </h1>
              <p style={{ color: "rgba(241,245,249,0.38)", fontSize: "13px" }}>
                Wallet, identity &amp; positions
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {/* Wallet info */}
            <div className="glass rounded-2xl p-6">
              <InfoRow
                label="Address"
                value={
                  <code style={{ fontSize: "11.5px", fontFamily: "monospace", color: "rgba(241,245,249,0.7)", wordBreak: "break-all" }}>
                    {accountInfo.address}
                  </code>
                }
              />
              <InfoRow label="Network" value={<span style={{ color: "#00d4ff", fontWeight: 600, fontSize: "13px" }}>{accountInfo.network}</span>} last />
            </div>

            <KycStatusBox address={accountInfo.address} />
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
