"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useWallet } from "../../components/providers/WalletProvider";
import { CheckCircle2, XCircle, Loader2, ShieldCheck, TrendingUp, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────

const VAULT_ID          = process.env.NEXT_PUBLIC_PERMISSIONED_VAULT_ID;
const CREDENTIAL_ISSUER = process.env.NEXT_PUBLIC_CREDENTIAL_ISSUER;
const KYC_ONE_TYPE      = process.env.NEXT_PUBLIC_CREDENTIAL_TYPE       || "4B59435F4F4E45";
const KYC_YIELD_TYPE    = process.env.NEXT_PUBLIC_YIELD_CREDENTIAL_TYPE || "4B59435F5949454C44";
const XRPL_HTTP         = process.env.NEXT_PUBLIC_XRPL_HTTP_URL         || "http://localhost:5005";

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToUtf8(hex) {
  try { return Buffer.from(hex, "hex").toString("utf8").replace(/\0/g, "").trim(); }
  catch { return hex; }
}

function fmtAssetAmount(amount, decimals = 6, asset) {
  if (!amount && amount !== 0) return "—";
  if (typeof amount === "string") {
    // If the vault asset is an IOU, the amount is a token unit — don't divide by 1M
    if (asset && (asset.currency || asset.mpt_issuance_id)) {
      const label = asset.currency?.length > 3 ? hexToUtf8(asset.currency) : (asset.currency ?? "");
      return Number(amount).toLocaleString(undefined, { maximumFractionDigits: decimals }) + " " + label;
    }
    return (Number(amount) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: decimals }) + " XRP";
  }
  if (typeof amount === "object") {
    if (amount.value != null) {
      const label = amount.currency?.length > 3 ? hexToUtf8(amount.currency) : (amount.currency ?? "");
      return Number(amount.value).toLocaleString(undefined, { maximumFractionDigits: decimals }) + " " + label;
    }
    if (amount.mpt_issuance_id != null) return Number(amount.value ?? 0).toLocaleString() + " (MPT)";
  }
  return String(amount);
}

function assetLabel(asset) {
  if (!asset) return "XRP";
  if (typeof asset === "object") {
    if (asset.currency) return asset.currency.length > 3 ? hexToUtf8(asset.currency) : asset.currency;
    if (asset.mpt_issuance_id) return "MPT";
  }
  return "XRP";
}

function toXrplAmount(human, asset) {
  const n = parseFloat(human);
  if (isNaN(n) || n <= 0) throw new Error("Invalid amount");
  if (!asset || (typeof asset === "object" && !asset.currency && !asset.mpt_issuance_id))
    return String(Math.round(n * 1_000_000));
  if (typeof asset === "object" && asset.currency)
    return { currency: asset.currency, issuer: asset.issuer, value: String(n) };
  if (typeof asset === "object" && asset.mpt_issuance_id)
    return { mpt_issuance_id: asset.mpt_issuance_id, value: String(Math.round(n)) };
  return String(Math.round(n * 1_000_000));
}

function getRawValue(amount) {
  if (!amount) return 0;
  if (typeof amount === "string") return Number(amount);
  if (typeof amount === "object" && amount.value != null) return Number(amount.value);
  return 0;
}

function estimateValue(userLp, totalLp, assetsTotal) {
  const totalLpN = Number(totalLp);
  if (!userLp || !totalLpN || !assetsTotal) return null;
  return (Number(userLp) / totalLpN) * getRawValue(assetsTotal);
}

// Simple utilization-based APY: 12 % at full utilization (linear)
const BASE_APY_RATE = 0.12;

function computeYieldStats(vault, lpBalance) {
  const total     = getRawValue(vault?.assetsTotal);
  const available = getRawValue(vault?.assetsAvailable);
  const totalLp   = Number(vault?.lpTokenBalance ?? "0");
  const userLp    = Number(lpBalance ?? "0");

  const utilized   = Math.max(0, total - available);
  const utilRate   = total > 0 ? utilized / total : 0;
  const apy        = utilRate * BASE_APY_RATE;
  const shareRatio = totalLp > 0 ? userLp / totalLp : 0;
  const userValue  = shareRatio * total;

  return { total, available, utilized, utilRate, apy, shareRatio, userValue, totalLp, userLp };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

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
  const kycOne   = data?.find(c => c.credentialType === KYC_ONE_TYPE   && c.accepted) ?? null;
  const kycYield = data?.find(c => c.credentialType === KYC_YIELD_TYPE && c.accepted) ?? null;
  return { loading: data === undefined, error, kycOne, kycYield, refetch };
}

function useVault() {
  const [vault, setVault] = useState(undefined);
  const [error, setError] = useState(null);
  useEffect(() => {
    fetch("/api/vault/info")
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setVault(d); })
      .catch(err => { setError(err.message); setVault(null); });
  }, []);
  return { vault, loading: vault === undefined, error };
}

function usePosition(address) {
  const [position, setPosition] = useState(undefined);
  const [error, setError]       = useState(null);
  const refetch = useCallback(() => {
    if (!address) { setPosition(null); return; }
    setPosition(undefined);
    fetch(`/api/account/position?address=${encodeURIComponent(address)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error);
        setPosition({ lpBalance: d.lpBalance ?? "0", issuanceId: d.issuanceId ?? null });
      })
      .catch(err => { setError(err.message); setPosition({ lpBalance: "0", issuanceId: null }); });
  }, [address]);
  useEffect(() => { refetch(); }, [refetch]);
  return { position, loading: position === undefined, error, refetch };
}

// ── Shared UI atoms ───────────────────────────────────────────────────────────

function SectionCard({ children }) {
  return <div className="glass rounded-2xl p-6">{children}</div>;
}

function CardRow({ label, value, last }) {
  return (
    <div className="flex items-center justify-between py-3" style={{ borderBottom: last ? "none" : "1px solid rgba(255,255,255,0.06)" }}>
      <span style={{ color: "rgba(241,245,249,0.4)", fontSize: "13px" }}>{label}</span>
      <span style={{ color: "rgba(241,245,249,0.85)", fontSize: "13px", fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function StatBox({ label, value, color }) {
  return (
    <div className="rounded-xl p-4 text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
      <p style={{ color: "rgba(241,245,249,0.38)", fontSize: "11px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "6px" }}>{label}</p>
      <p style={{ color: color || "rgba(241,245,249,0.85)", fontSize: "16px", fontWeight: 700 }}>{value}</p>
    </div>
  );
}

function TxAlert({ type, title, hash }) {
  const ok = type === "success";
  return (
    <div className="rounded-xl p-4" style={{ background: ok ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)", border: `1px solid ${ok ? "rgba(16,185,129,0.22)" : "rgba(239,68,68,0.22)"}` }}>
      <div className="flex items-center gap-2 mb-1">
        {ok ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" style={{ color: "#10b981" }} />
             : <XCircle     className="h-4 w-4 flex-shrink-0" style={{ color: "#f87171" }} />}
        <span style={{ color: ok ? "#10b981" : "#f87171", fontSize: "13px", fontWeight: 600 }}>{title}</span>
      </div>
      {hash && <p style={{ color: "rgba(241,245,249,0.4)", fontSize: "11px", fontFamily: "monospace", wordBreak: "break-all", marginTop: "4px" }}>{hash}</p>}
    </div>
  );
}

function GlassInput({ id, label, value, onChange, disabled, placeholder }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <label htmlFor={id} style={{ color: "rgba(241,245,249,0.55)", fontSize: "12px", fontWeight: 600, letterSpacing: "0.04em" }}>{label}</label>
      <input
        id={id} type="number" min="0" step="any" placeholder={placeholder}
        value={value} onChange={onChange} disabled={disabled}
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "12px", padding: "10px 14px", color: "rgba(241,245,249,0.9)", fontSize: "14px", outline: "none", width: "100%", transition: "border-color 0.2s" }}
        onFocus={e => { e.target.style.borderColor = "rgba(0,212,255,0.4)"; }}
        onBlur={e  => { e.target.style.borderColor = "rgba(255,255,255,0.1)"; }}
      />
    </div>
  );
}

// ── Credential section ────────────────────────────────────────────────────────

const CS = { IDLE: "idle", ISSUING: "issuing", ISSUED: "issued", ACCEPTING: "accepting", DONE: "done", ERROR: "error" };

function CredentialSection({ address, walletManager, kycOne, kycYield, onAccepted }) {
  const [step, setStep]           = useState(CS.IDLE);
  const [issueTxHash, setIssue]   = useState(null);
  const [acceptTxHash, setAccept] = useState(null);
  const [error, setError]         = useState(null);

  const handleIssue = useCallback(async () => {
    setStep(CS.ISSUING); setError(null);
    try {
      const res  = await fetch("/api/credential/issue-yield", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subjectAddress: address }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Issue failed");
      setIssue(data.txHash); setStep(CS.ISSUED);
    } catch (err) { setError(err.message); setStep(CS.ERROR); }
  }, [address]);

  const handleAccept = useCallback(async () => {
    if (!walletManager) return;
    setStep(CS.ACCEPTING);
    try {
      const result = await walletManager.signAndSubmit({ TransactionType: "CredentialAccept", Account: address, Issuer: CREDENTIAL_ISSUER, CredentialType: KYC_YIELD_TYPE });
      setAccept(result.hash ?? result.id ?? "submitted"); setStep(CS.DONE); onAccepted?.();
    } catch (err) { setError(err.message); setStep(CS.ERROR); }
  }, [walletManager, address, onAccepted]);

  if (kycYield) {
    return (
      <SectionCard>
        <div className="flex items-center gap-3 mb-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.22)" }}>
            <ShieldCheck className="h-[18px] w-[18px]" style={{ color: "#10b981" }} />
          </div>
          <div>
            <p className="font-semibold" style={{ color: "rgba(241,245,249,0.9)", fontSize: "14px" }}>Yield Credential</p>
            <p style={{ color: "#10b981", fontSize: "12px", fontWeight: 600 }}>Active</p>
          </div>
        </div>
        <CardRow label="Type"   value={<code style={{ fontFamily: "monospace", fontSize: "12px", color: "#00d4ff" }}>{hexToUtf8(KYC_YIELD_TYPE)}</code>} />
        <CardRow label="Issuer" value={<code style={{ fontFamily: "monospace", fontSize: "11px", color: "rgba(241,245,249,0.5)", wordBreak: "break-all" }}>{kycYield.issuer}</code>} last />
      </SectionCard>
    );
  }

  if (!kycOne) {
    return (
      <SectionCard>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <ShieldCheck className="h-[18px] w-[18px]" style={{ color: "rgba(241,245,249,0.4)" }} />
          </div>
          <p className="font-semibold" style={{ color: "rgba(241,245,249,0.9)", fontSize: "14px" }}>Yield Credential</p>
        </div>
        <p style={{ color: "rgba(241,245,249,0.45)", fontSize: "13px", lineHeight: 1.65, marginBottom: "20px" }}>
          You need a verified KYC identity before accessing yield products.
        </p>
        <Link href="/onboarding" className="btn-gradient w-full justify-center" style={{ borderRadius: "12px" }}>
          Complete KYC Onboarding
        </Link>
      </SectionCard>
    );
  }

  return (
    <SectionCard>
      <div className="flex items-center gap-3 mb-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: "rgba(0,212,255,0.12)", border: "1px solid rgba(0,212,255,0.22)" }}>
          <ShieldCheck className="h-[18px] w-[18px]" style={{ color: "#00d4ff" }} />
        </div>
        <p className="font-semibold" style={{ color: "rgba(241,245,249,0.9)", fontSize: "14px" }}>Yield Credential</p>
      </div>

      {step === CS.IDLE && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <p style={{ color: "rgba(241,245,249,0.45)", fontSize: "13px", lineHeight: 1.65 }}>
            Your KYC identity is verified. Claim your <strong style={{ color: "rgba(241,245,249,0.8)" }}>KYC_YIELD</strong> credential to unlock access to liquidity pools.
          </p>
          <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.18)" }}>
            <span style={{ color: "rgba(241,245,249,0.45)", fontSize: "12.5px" }}>Base KYC</span>
            <span style={{ color: "#10b981", fontSize: "12px", fontWeight: 600 }}>✓ Verified</span>
          </div>
          <button onClick={handleIssue} className="btn-gradient w-full justify-center" style={{ borderRadius: "12px" }}>
            Claim KYC_YIELD Credential
          </button>
        </div>
      )}

      {step === CS.ISSUING && (
        <div className="flex items-center justify-center gap-3 py-6">
          <Loader2 className="h-5 w-5 animate-spin" style={{ color: "#7c3aed" }} />
          <span style={{ color: "rgba(241,245,249,0.55)", fontSize: "13px" }}>Issuing credential on-chain…</span>
        </div>
      )}

      {step === CS.ISSUED && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <TxAlert type="success" title="Credential Issued" hash={issueTxHash} />
          <p style={{ color: "rgba(241,245,249,0.45)", fontSize: "13px", lineHeight: 1.6 }}>
            Now sign the <code style={{ fontFamily: "monospace", background: "rgba(255,255,255,0.07)", padding: "1px 6px", borderRadius: "4px", fontSize: "12px" }}>CredentialAccept</code> in your wallet.
          </p>
          <button onClick={handleAccept} className="btn-gradient w-full justify-center" style={{ borderRadius: "12px" }}>
            Accept Credential
          </button>
        </div>
      )}

      {step === CS.ACCEPTING && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <TxAlert type="success" title="Credential Issued" hash={issueTxHash} />
          <div className="flex items-center justify-center gap-3 py-3">
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: "#00d4ff" }} />
            <span style={{ color: "rgba(241,245,249,0.55)", fontSize: "13px" }}>Waiting for wallet signature…</span>
          </div>
        </div>
      )}

      {step === CS.DONE && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <TxAlert type="success" title="KYC_YIELD Activated" />
          <div className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}>
            {issueTxHash  && <div className="px-4 py-2.5 text-xs font-mono break-all" style={{ color: "rgba(241,245,249,0.45)", borderBottom: acceptTxHash ? "1px solid rgba(255,255,255,0.06)" : "none" }}><span style={{ color: "rgba(241,245,249,0.25)", fontFamily: "sans-serif" }}>Issue </span>{issueTxHash}</div>}
            {acceptTxHash && <div className="px-4 py-2.5 text-xs font-mono break-all" style={{ color: "rgba(241,245,249,0.45)" }}><span style={{ color: "rgba(241,245,249,0.25)", fontFamily: "sans-serif" }}>Accept </span>{acceptTxHash}</div>}
          </div>
        </div>
      )}

      {step === CS.ERROR && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <TxAlert type="error" title={error} />
          <button className="btn-ghost w-full justify-center" style={{ borderRadius: "12px" }} onClick={() => { setStep(CS.IDLE); setError(null); }}>
            Try again
          </button>
        </div>
      )}
    </SectionCard>
  );
}

// ── Vault stats ───────────────────────────────────────────────────────────────

function VaultStats({ vault }) {
  const stats      = computeYieldStats(vault, "0");
  const utilPct    = (stats.utilRate * 100).toFixed(1);
  const apyPct     = (stats.apy * 100).toFixed(2);
  const label      = assetLabel(vault.asset);

  return (
    <SectionCard>
      <div className="flex items-center gap-3 mb-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: "rgba(0,212,255,0.12)", border: "1px solid rgba(0,212,255,0.22)" }}>
          <TrendingUp className="h-[18px] w-[18px]" style={{ color: "#00d4ff" }} />
        </div>
        <div>
          <p className="font-semibold" style={{ color: "rgba(241,245,249,0.9)", fontSize: "14px" }}>Pool</p>
          <p style={{ fontSize: "11px", fontFamily: "monospace", color: "rgba(241,245,249,0.3)" }}>{vault.vaultId?.slice(0, 8)}…{vault.vaultId?.slice(-6)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <StatBox label="TVL"        value={fmtAssetAmount(vault.assetsTotal,     6, vault.asset)} color="#00d4ff" />
        <StatBox label="Available"  value={fmtAssetAmount(vault.assetsAvailable, 6, vault.asset)} color="rgba(241,245,249,0.85)" />
        <StatBox label="Asset"      value={label}    color="#7c3aed" />
        <StatBox label="Current APY" value={`${apyPct} %`} color="#10b981" />
      </div>

      {/* Utilization bar */}
      <div style={{ marginTop: "4px" }}>
        <div className="flex justify-between mb-1.5" style={{ fontSize: "11px", color: "rgba(241,245,249,0.38)" }}>
          <span>Pool utilization</span>
          <span style={{ fontWeight: 600, color: stats.utilRate > 0.8 ? "#f59e0b" : "#10b981" }}>{utilPct} %</span>
        </div>
        <div style={{ height: "6px", borderRadius: "3px", background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${utilPct}%`,
            background: stats.utilRate > 0.8 ? "linear-gradient(90deg,#f59e0b,#ef4444)" : "linear-gradient(90deg,#00d4ff,#10b981)",
            borderRadius: "3px", transition: "width 0.6s ease",
          }} />
        </div>
        <p style={{ fontSize: "11px", color: "rgba(241,245,249,0.25)", marginTop: "6px" }}>
          {fmtAssetAmount(vault.assetsAvailable, 2, vault.asset)} available · APY scales linearly with utilization
        </p>
      </div>
    </SectionCard>
  );
}

// ── My Position ───────────────────────────────────────────────────────────────

function MyPosition({ vault, position }) {
  const lpBalance = position?.lpBalance ?? "0";
  const label     = assetLabel(vault.asset);
  const stats     = computeYieldStats(vault, lpBalance);

  const fmtVal = (n) => {
    if (!n) return "—";
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " " + label;
  };

  const hasPosition = stats.userLp > 0;

  return (
    <SectionCard>
      <p className="font-semibold mb-5" style={{ color: "rgba(241,245,249,0.9)", fontSize: "14px" }}>My Position</p>

      {!hasPosition ? (
        <p style={{ color: "rgba(241,245,249,0.3)", fontSize: "13px", textAlign: "center", padding: "12px 0" }}>
          Deposit {label} to start earning yield
        </p>
      ) : (
        <>
          {/* Main value */}
          <div className="rounded-xl p-4 mb-4 text-center" style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.16)" }}>
            <p style={{ color: "rgba(241,245,249,0.38)", fontSize: "11px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "6px" }}>
              Current value
            </p>
            <p style={{ color: "#10b981", fontSize: "28px", fontWeight: 800, letterSpacing: "-0.02em" }}>
              {fmtVal(stats.userValue)}
            </p>
            <p style={{ color: "rgba(241,245,249,0.3)", fontSize: "12px", marginTop: "4px" }}>
              {stats.shareRatio > 0 ? `${(stats.shareRatio * 100).toFixed(4)} % of pool` : ""}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <StatBox label="Pool share"  value={`${(stats.shareRatio * 100).toFixed(4)} %`} color="#7c3aed" />
            <StatBox label="Current APY" value={stats.apy > 0 ? `${(stats.apy * 100).toFixed(2)} %` : "0.00 %"} color="#10b981" />
          </div>
        </>
      )}
    </SectionCard>
  );
}

// ── Forms ─────────────────────────────────────────────────────────────────────

const TX = { IDLE: "idle", PENDING: "pending", DONE: "done", ERROR: "error" };

function DepositForm({ vault, address, walletManager, onSuccess }) {
  const [amount, setAmount] = useState("");
  const [state, setState]   = useState(TX.IDLE);
  const [txHash, setTxHash] = useState(null);
  const [error, setError]   = useState(null);
  const label = assetLabel(vault.asset);
  const canSubmit = !!amount && Number(amount) > 0 && state !== TX.PENDING;

  const handleDeposit = useCallback(async () => {
    if (!walletManager || !address) return;
    setState(TX.PENDING); setError(null);
    try {
      const result = await walletManager.signAndSubmit({ TransactionType: "VaultDeposit", Account: address, VaultID: VAULT_ID, Amount: toXrplAmount(amount, vault.asset) });
      const txResult = result?.result?.meta?.TransactionResult ?? result?.meta?.TransactionResult;
      if (txResult && txResult !== "tesSUCCESS") throw new Error(txResult);
      const hash = result?.hash ?? result?.result?.hash ?? result?.id;
      if (!hash) throw new Error("Transaction failed: no hash returned");
      setTxHash(hash); setState(TX.DONE); setAmount(""); onSuccess?.();
    } catch (err) { setError(err.message); setState(TX.ERROR); }
  }, [walletManager, address, amount, vault.asset, onSuccess]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <p style={{ color: "rgba(241,245,249,0.45)", fontSize: "13px", lineHeight: 1.65 }}>
        Deposit {label} into the vault and receive LP tokens representing your share.
      </p>
      {state === TX.DONE  && <TxAlert type="success" title="Deposit submitted"  hash={txHash} />}
      {state === TX.ERROR && <TxAlert type="error"   title="Deposit failed"     hash={error}  />}
      <GlassInput id="deposit-amount" label={`Amount (${label})`} placeholder="e.g. 100" value={amount}
        onChange={e => { setAmount(e.target.value); if (state !== TX.IDLE) setState(TX.IDLE); }}
        disabled={state === TX.PENDING}
      />
      <button onClick={handleDeposit} disabled={!canSubmit}
        className="btn-gradient w-full justify-center"
        style={{ borderRadius: "12px", opacity: canSubmit ? 1 : 0.45, cursor: canSubmit ? "pointer" : "not-allowed" }}
      >
        {state === TX.PENDING
          ? <><Loader2 className="h-4 w-4 animate-spin" />Waiting for signature…</>
          : <><ArrowDownToLine className="h-4 w-4" />Deposit</>}
      </button>
    </div>
  );
}

function WithdrawForm({ vault, address, walletManager, position, onSuccess }) {
  const [amount, setAmount] = useState("");
  const [state, setState]   = useState(TX.IDLE);
  const [txHash, setTxHash] = useState(null);
  const [error, setError]   = useState(null);
  const label     = assetLabel(vault.asset);
  const lpBalance = Number(position?.lpBalance ?? 0);
  const canSubmit = !!amount && Number(amount) > 0 && state !== TX.PENDING && lpBalance > 0;

  const handleWithdraw = useCallback(async () => {
    if (!walletManager || !address) return;
    setState(TX.PENDING); setError(null);
    try {
      const result = await walletManager.signAndSubmit({ TransactionType: "VaultWithdraw", Account: address, VaultID: VAULT_ID, Amount: toXrplAmount(amount, vault.asset) });
      const txResult = result?.result?.meta?.TransactionResult ?? result?.meta?.TransactionResult;
      if (txResult && txResult !== "tesSUCCESS") throw new Error(txResult);
      const hash = result?.hash ?? result?.result?.hash ?? result?.id;
      if (!hash) throw new Error("Transaction failed: no hash returned");
      setTxHash(hash); setState(TX.DONE); setAmount(""); onSuccess?.();
    } catch (err) { setError(err.message); setState(TX.ERROR); }
  }, [walletManager, address, amount, vault.asset, onSuccess]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <p style={{ color: "rgba(241,245,249,0.45)", fontSize: "13px", lineHeight: 1.65 }}>
        Withdraw {label} from the vault by burning your LP tokens.
        {lpBalance > 0 && <span style={{ color: "rgba(241,245,249,0.7)", fontWeight: 500 }}> You hold {lpBalance.toLocaleString()} LP tokens.</span>}
      </p>
      {lpBalance === 0 && (
        <div className="rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
          <p style={{ color: "rgba(241,245,249,0.35)", fontSize: "13px" }}>You have no LP tokens to redeem yet.</p>
        </div>
      )}
      {state === TX.DONE  && <TxAlert type="success" title="Withdrawal submitted"  hash={txHash} />}
      {state === TX.ERROR && <TxAlert type="error"   title="Withdrawal failed"     hash={error}  />}
      <GlassInput id="withdraw-amount" label={`Amount to receive (${label})`} placeholder="e.g. 50" value={amount}
        onChange={e => { setAmount(e.target.value); if (state !== TX.IDLE) setState(TX.IDLE); }}
        disabled={state === TX.PENDING || lpBalance === 0}
      />
      <button onClick={handleWithdraw} disabled={!canSubmit}
        className="btn-ghost w-full justify-center"
        style={{ borderRadius: "12px", opacity: canSubmit ? 1 : 0.45, cursor: canSubmit ? "pointer" : "not-allowed" }}
      >
        {state === TX.PENDING
          ? <><Loader2 className="h-4 w-4 animate-spin" />Waiting for signature…</>
          : <><ArrowUpFromLine className="h-4 w-4" />Withdraw</>}
      </button>
    </div>
  );
}

// ── Tab toggle ────────────────────────────────────────────────────────────────

function TabToggle({ value, onChange }) {
  const tab = (v, Icon, label) => (
    <button onClick={() => onChange(v)} className="flex items-center gap-2 flex-1 justify-center py-2.5 rounded-xl text-sm font-semibold transition-all duration-150"
      style={{ background: value === v ? "rgba(255,255,255,0.08)" : "transparent", border: value === v ? "1px solid rgba(255,255,255,0.12)" : "1px solid transparent", color: value === v ? "rgba(241,245,249,0.9)" : "rgba(241,245,249,0.38)" }}
    >
      <Icon className="h-4 w-4" />{label}
    </button>
  );
  return (
    <div className="flex gap-1 p-1 rounded-2xl mb-6" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
      {tab("deposit",  ArrowDownToLine, "Deposit")}
      {tab("withdraw", ArrowUpFromLine,  "Withdraw")}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function YieldPage() {
  const { isConnected, accountInfo, walletManager } = useWallet();
  const address = accountInfo?.address;

  const { loading: credLoading, kycOne, kycYield, refetch: refetchCreds } = useCredentials(address);
  const { vault, loading: vaultLoading, error: vaultError }               = useVault();
  const { position, loading: posLoading, refetch: refetchPosition }       = usePosition(address);
  const [activeTab, setActiveTab]                                         = useState("deposit");

  const onCredentialAccepted = useCallback(() => { setTimeout(() => refetchCreds(), 2000); }, [refetchCreds]);
  const onTxSuccess          = useCallback(() => { setTimeout(() => refetchPosition(), 3000); }, [refetchPosition]);

  if (!isConnected || !accountInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="glass rounded-2xl p-10 text-center max-w-sm mx-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl mx-auto mb-5" style={{ background: "rgba(0,212,255,0.1)", border: "1px solid rgba(0,212,255,0.2)" }}>
            <TrendingUp className="h-7 w-7" style={{ color: "#00d4ff" }} />
          </div>
          <p className="font-semibold mb-2" style={{ color: "rgba(241,245,249,0.9)" }}>Wallet not connected</p>
          <p style={{ color: "rgba(241,245,249,0.4)", fontSize: "13px", lineHeight: 1.6 }}>Connect your wallet to access yield products.</p>
        </div>
      </div>
    );
  }

  const yieldUnlocked = !!kycYield;

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1">
        <div className="container py-10 max-w-xl">

          <div className="flex items-center gap-3 mb-8">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: "rgba(0,212,255,0.12)", border: "1px solid rgba(0,212,255,0.22)" }}>
              <TrendingUp className="h-[18px] w-[18px]" style={{ color: "#00d4ff" }} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: "rgba(241,245,249,0.92)" }}>Yield</h1>
              <p style={{ color: "rgba(241,245,249,0.38)", fontSize: "13px" }}>Provide liquidity and earn yield on the XRPL lending pool</p>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

            {credLoading ? (
              <SectionCard>
                <div className="flex items-center gap-3">
                  <Loader2 className="h-4 w-4 animate-spin" style={{ color: "#00d4ff" }} />
                  <span style={{ color: "rgba(241,245,249,0.4)", fontSize: "13px" }}>Checking credentials…</span>
                </div>
              </SectionCard>
            ) : (
              <CredentialSection address={address} walletManager={walletManager} kycOne={kycOne} kycYield={kycYield} onAccepted={onCredentialAccepted} />
            )}

            {yieldUnlocked && (
              <>
                {vaultError && (
                  <div className="rounded-2xl px-5 py-4" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    <p style={{ color: "#f87171", fontSize: "13px" }}>Could not load vault data: {vaultError}</p>
                  </div>
                )}
                {vaultLoading
                  ? <SectionCard><div className="flex items-center gap-3"><Loader2 className="h-4 w-4 animate-spin" style={{ color: "#00d4ff" }} /><span style={{ color: "rgba(241,245,249,0.4)", fontSize: "13px" }}>Loading vault…</span></div></SectionCard>
                  : vault ? <VaultStats vault={vault} /> : null
                }
                {vault && (posLoading
                  ? <SectionCard><div className="flex items-center gap-3"><Loader2 className="h-4 w-4 animate-spin" style={{ color: "#00d4ff" }} /><span style={{ color: "rgba(241,245,249,0.4)", fontSize: "13px" }}>Loading position…</span></div></SectionCard>
                  : <MyPosition vault={vault} position={position} />
                )}
                {vault && (
                  <SectionCard>
                    <TabToggle value={activeTab} onChange={setActiveTab} />
                    {activeTab === "deposit"
                      ? <DepositForm  vault={vault} address={address} walletManager={walletManager} onSuccess={onTxSuccess} />
                      : <WithdrawForm vault={vault} address={address} walletManager={walletManager} position={position} onSuccess={onTxSuccess} />
                    }
                  </SectionCard>
                )}
              </>
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
