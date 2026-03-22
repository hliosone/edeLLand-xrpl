"use client";

import Link from "next/link";
import { useWallet } from "../components/providers/WalletProvider";
import { ShieldCheck, Zap, CreditCard, ArrowRight, Lock, CheckCircle2, TrendingUp } from "lucide-react";

// ── Orb background ────────────────────────────────────────────────────────────

function Orbs() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      <div style={{
        position: "absolute", top: "-8%", right: "-4%",
        width: "640px", height: "640px",
        background: "radial-gradient(circle, rgba(0,212,255,0.13) 0%, transparent 68%)",
        filter: "blur(70px)",
        animation: "orb 22s ease-in-out infinite",
        willChange: "transform",
      }} />
      <div style={{
        position: "absolute", bottom: "-12%", left: "-6%",
        width: "520px", height: "520px",
        background: "radial-gradient(circle, rgba(124,58,237,0.14) 0%, transparent 68%)",
        filter: "blur(70px)",
        animation: "orb 29s ease-in-out infinite reverse",
        willChange: "transform",
      }} />
      <div style={{
        position: "absolute", top: "38%", left: "42%",
        width: "380px", height: "380px",
        background: "radial-gradient(circle, rgba(16,185,129,0.07) 0%, transparent 68%)",
        filter: "blur(90px)",
        animation: "orb 17s ease-in-out infinite alternate",
        willChange: "transform",
      }} />
    </div>
  );
}

// ── Grid overlay ──────────────────────────────────────────────────────────────

function GridOverlay() {
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      aria-hidden
      style={{
        backgroundImage: `
          linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px)
        `,
        backgroundSize: "64px 64px",
        maskImage: "radial-gradient(ellipse 80% 70% at 50% 50%, black 20%, transparent 75%)",
      }}
    />
  );
}

// ── Feature item ──────────────────────────────────────────────────────────────

function FeatureItem({ n, title, description, color }) {
  return (
    <div
      className="group glass rounded-2xl p-6 flex flex-col gap-3"
      style={{ borderColor: "rgba(255,255,255,0.07)" }}
    >
      <span
        className="font-black leading-none"
        style={{ fontSize: "48px", color: `${color}22`, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}
      >
        {n}
      </span>
      <div>
        <h3
          className="font-bold mb-2"
          style={{ color: "rgba(241,245,249,0.9)", fontSize: "15px", letterSpacing: "-0.01em" }}
        >
          {title}
        </h3>
        <p style={{ color: "rgba(241,245,249,0.38)", fontSize: "13px", lineHeight: "1.65" }}>
          {description}
        </p>
      </div>
      <div style={{ width: "28px", height: "2px", background: color, borderRadius: "2px", marginTop: "auto", paddingTop: "8px" }} />
    </div>
  );
}

// ── Step ──────────────────────────────────────────────────────────────────────

function Step({ n, label, sub, color }) {
  return (
    <div className="flex items-start gap-4">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold"
        style={{ background: `${color}16`, color, border: `1px solid ${color}28` }}
      >
        {n}
      </div>
      <div className="pt-1">
        <p className="text-sm font-semibold mb-1" style={{ color: "rgba(241,245,249,0.85)" }}>
          {label}
        </p>
        <p style={{ color: "rgba(241,245,249,0.4)", fontSize: "12.5px", lineHeight: "1.6" }}>
          {sub}
        </p>
      </div>
    </div>
  );
}

// ── Quick card ────────────────────────────────────────────────────────────────

function QuickCard({ href, icon: Icon, label, description, color }) {
  return (
    <Link
      href={href}
      className="glass glass-glow rounded-2xl p-5 flex items-center justify-between group"
      style={{ textDecoration: "none" }}
    >
      <div className="flex items-center gap-4">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl"
          style={{ background: `${color}16`, border: `1px solid ${color}22` }}
        >
          <Icon className="h-[18px] w-[18px]" style={{ color }} />
        </div>
        <div>
          <p className="text-sm font-semibold" style={{ color: "rgba(241,245,249,0.85)" }}>
            {label}
          </p>
          <p style={{ color: "rgba(241,245,249,0.38)", fontSize: "12px" }}>{description}</p>
        </div>
      </div>
      <ArrowRight
        className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1"
        style={{ color: "rgba(241,245,249,0.22)" }}
      />
    </Link>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Home() {
  const { isConnected, accountInfo } = useWallet();
  const address = accountInfo?.address;
  const shortAddr = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : null;

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1">

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden" style={{ minHeight: "calc(90vh - 56px)", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <Orbs />
          <GridOverlay />

          <div className="container relative py-24 md:py-32">

            {/* Headline */}
            <h1
              className="text-5xl md:text-[72px] font-bold tracking-tight leading-[1.07] mb-7 gradient-text"
              style={{ animation: "slide-up 0.65s 0.08s ease-out both" }}
            >
              Prove who you are.<br />
              Borrow what you need.
            </h1>

            {/* Subtitle */}
            <p
              className="text-base md:text-lg mb-10 max-w-lg leading-relaxed"
              style={{ color: "rgba(241,245,249,0.5)", animation: "slide-up 0.65s 0.18s ease-out both" }}
            >
              edeLLand is a KYC-gated lending platform on the XRP Ledger.
              Get instant uncollateralized credit, verified once, active forever.
            </p>

            {/* CTA */}
            <div
              className="flex flex-wrap items-center gap-3"
              style={{ animation: "slide-up 0.65s 0.28s ease-out both" }}
            >
              {isConnected ? (
                <>
                  <Link href="/loans" className="btn-gradient">
                    My Loans <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link href="/account" className="btn-ghost">
                    {shortAddr ?? "My Account"}
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/onboarding" className="btn-gradient">
                    Get started <ArrowRight className="h-4 w-4" />
                  </Link>
                  <span style={{ color: "rgba(241,245,249,0.32)", fontSize: "13px" }}>
                    Connect your wallet to begin
                  </span>
                </>
              )}
            </div>

          </div>
        </section>

        <hr className="divider" />

        {/* ── Authenticated: quick actions ──────────────────────────────────── */}
        {isConnected && (
          <>
            <section>
              <div className="container py-12">
                <p className="section-label">Quick access</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mt-6">
                  <QuickCard href="/loans"      icon={CreditCard}   label="Loans"          description="Active & past positions"    color="#00d4ff" />
                  <QuickCard href="/yield"      icon={TrendingUp}   label="Yield"          description="Earn on your deposits"      color="#f59e0b" />
                  <QuickCard href="/account"    icon={ShieldCheck}  label="My Account"     description="Credentials & wallet info"  color="#10b981" />
                  <QuickCard href="/onboarding" icon={CheckCircle2} label="KYC"            description="Verify or refresh identity" color="#7c3aed" />
                </div>
              </div>
            </section>
            <hr className="divider" />
          </>
        )}

        {/* ── How it works ──────────────────────────────────────────────────── */}
        <section>
          <div className="container py-16 md:py-24">
            <div className="grid md:grid-cols-2 gap-16 items-center">

              <div>
                <p className="section-label" style={{ color: "#00d4ff" }}>How it works</p>
                <h2 className="text-3xl font-bold tracking-tight mt-3 mb-10" style={{ color: "rgba(241,245,249,0.9)" }}>
                  Access credit<br />in three steps
                </h2>
                <div className="flex flex-col gap-7">
                  <Step n="01" label="Verify your identity"      sub="Complete KYC with the Edel-ID app in seconds — name, age 18+, nationality."       color="#00d4ff" />
                  <Step n="02" label="Receive your credential"   sub="Your verified identity is issued as a credential, linked to your wallet."           color="#7c3aed" />
                  <Step n="03" label="Choose your loan type"     sub="Borrow unsecured against your verified identity, or secured with collateral. Fixed terms, transparent rates." color="#10b981" />
                </div>
                {!isConnected && (
                  <Link href="/onboarding" className="btn-gradient inline-flex mt-10">
                    Start verification <ArrowRight className="h-4 w-4" />
                  </Link>
                )}
              </div>

              {/* Product cards */}
              <div className="flex flex-col gap-4">
                <div className="glass rounded-2xl p-6" style={{ borderColor: "rgba(0,212,255,0.12)" }}>
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="text-sm font-bold mb-1" style={{ color: "rgba(241,245,249,0.9)" }}>Unsecured credit</p>
                      <p style={{ color: "rgba(241,245,249,0.42)", fontSize: "13px", lineHeight: "1.6" }}>
                        Borrow against your verified identity. No collateral required — your KYC credential is your guarantee.
                      </p>
                    </div>
                    <div className="ml-4 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: "rgba(0,212,255,0.1)", border: "1px solid rgba(0,212,255,0.2)" }}>
                      <ShieldCheck className="h-4 w-4" style={{ color: "#00d4ff" }} />
                    </div>
                  </div>
                  <div className="flex gap-3">
                    {["KYC required", "Fixed term", "Instant"].map((tag) => (
                      <span key={tag} className="px-2.5 py-1 rounded-full text-xs" style={{ background: "rgba(0,212,255,0.08)", color: "#00d4ff" }}>{tag}</span>
                    ))}
                  </div>
                </div>

                <div className="glass rounded-2xl p-6" style={{ borderColor: "rgba(124,58,237,0.12)" }}>
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="text-sm font-bold mb-1" style={{ color: "rgba(241,245,249,0.9)" }}>Secured credit</p>
                      <p style={{ color: "rgba(241,245,249,0.42)", fontSize: "13px", lineHeight: "1.6" }}>
                        Pledge collateral to unlock higher limits and preferential rates, with the same verified-identity framework.
                      </p>
                    </div>
                    <div className="ml-4 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.2)" }}>
                      <Lock className="h-4 w-4" style={{ color: "#7c3aed" }} />
                    </div>
                  </div>
                  <div className="flex gap-3">
                    {["KYC required", "Collateral-backed", "Higher limits"].map((tag) => (
                      <span key={tag} className="px-2.5 py-1 rounded-full text-xs" style={{ background: "rgba(124,58,237,0.08)", color: "#7c3aed" }}>{tag}</span>
                    ))}
                  </div>
                </div>
              </div>

            </div>
          </div>
        </section>

        <hr className="divider" />

        {/* ── Feature grid ──────────────────────────────────────────────────── */}
        <section>
          <div className="container py-16 md:py-24">
            <p className="section-label" style={{ color: "#7c3aed" }}>Platform features</p>
            <h2 className="text-3xl font-bold tracking-tight mt-3 mb-12" style={{ color: "rgba(241,245,249,0.9)" }}>
              Everything you need,<br />nothing you don&apos;t
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FeatureItem n="01" title="Permissioned access"  description="KYC enforced at the protocol level via XRPL verifiable credentials. No credential, no loan."           color="#10b981" />
              <FeatureItem n="02" title="Instant credit"       description="Loans originate on-chain in seconds. Fixed schedule, clear amortization, no hidden fees."               color="#f59e0b" />
              <FeatureItem n="03" title="Flexible credit lines" description="Choose between unsecured loans backed by your identity or collateralized credit for higher limits — same KYC, two products."  color="#00d4ff" />
              <FeatureItem n="04" title="Non-custodial"        description="Your keys, your funds. Your wallet signs every transaction. The platform never holds assets."           color="#7c3aed" />
            </div>
          </div>
        </section>

        {/* ── Bottom CTA ────────────────────────────────────────────────────── */}
        {!isConnected && (
          <>
            <hr className="divider" />
            <section>
              <div className="container py-20 text-center">
                <h2 className="text-3xl font-bold tracking-tight mb-4" style={{ color: "rgba(241,245,249,0.9)" }}>
                  Ready to get started?
                </h2>
                <p className="mb-8 max-w-md mx-auto" style={{ color: "rgba(241,245,249,0.42)", fontSize: "14px", lineHeight: 1.7 }}>
                  Connect your wallet and complete KYC in under a minute to unlock on-chain credit.
                </p>
                <Link href="/onboarding" className="btn-gradient" style={{ fontSize: "15px", padding: "13px 30px" }}>
                  Verify identity now <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </section>
          </>
        )}

      </main>

      <footer style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "20px 0" }}>
        <div className="container flex flex-col sm:flex-row items-center justify-between gap-2" style={{ color: "rgba(241,245,249,0.25)", fontSize: "12px" }}>
          <span>edeLLand · Permissioned lending on XRPL</span>
          <div className="flex items-center gap-5">
            <Link href="/admin" style={{ color: "inherit", textDecoration: "none" }} className="hover:text-white/50 transition-colors">Admin</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
