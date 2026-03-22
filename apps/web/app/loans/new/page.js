"use client";

import { useEffect, useState } from "react";
import { useRouter }           from "next/navigation";
import { useWallet }           from "../../../components/providers/WalletProvider";
import { Button }              from "../../../components/ui/button";
import { Input }               from "../../../components/ui/input";
import { Label }               from "../../../components/ui/label";
import { Badge }               from "../../../components/ui/badge";

// ── Constants ─────────────────────────────────────────────────────────────────

const CRED_KYC_FULL   = "4B59435F46554C4C";
const CRED_KYC_OVER18 = "4B59435F4F5645523138";
const CRED_TIER1      = "4B59435F5449455231";
const CRED_TIER2      = "4B59435F5449455232";
const TIER_MAX        = { [CRED_TIER2]: 2000, [CRED_TIER1]: 500 };

const ORIGINATION_FEE_RATE = 0.08;
const PAYMENT_TOTAL        = 3;
const COLLATERAL_RATIO     = 1.25;

const RIPPLE_EPOCH = 946684800;
function fmtDate(ts) {
  if (!ts) return "—";
  return new Date((ts + RIPPLE_EPOCH) * 1000).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

// ── Step indicator ────────────────────────────────────────────────────────────

const STEPS = ["Eligibility", "Amount", "Co-sign", "Collateral", "Loan"];

function StepBar({ current }) {
  return (
    <div className="flex items-center gap-1 mb-8">
      {STEPS.map((label, i) => {
        const idx     = i + 1;
        const done    = idx < current;
        const active  = idx === current;
        return (
          <div key={label} className="flex items-center gap-1 flex-1">
            <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold shrink-0 transition-colors ${
              done   ? "bg-green-600 text-white" :
              active ? "bg-primary text-primary-foreground" :
                       "bg-muted text-muted-foreground"
            }`}>
              {done ? "✓" : idx}
            </div>
            <span className={`text-xs truncate ${active ? "font-medium" : "text-muted-foreground"}`}>
              {label}
            </span>
            {i < STEPS.length - 1 && <div className="flex-1 h-px bg-border mx-1" />}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 1 — Eligibility ──────────────────────────────────────────────────────

function StepEligibility({ address, onNext }) {
  const [loading, setLoading] = useState(true);
  const [kyc,     setKyc]     = useState(null); // null | 'over18' | 'full'
  const [tier,    setTier]    = useState(null); // null | 1 | 2
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!address) return;
    fetch(`/api/account/credential?address=${address}`)
      .then((r) => r.json())
      .then((data) => {
        const creds = data.credentials ?? data ?? [];
        const types = new Set(
          creds.filter((c) => c.accepted).map((c) => c.credentialType)
        );
        const hasKyc = types.has(CRED_KYC_FULL) || types.has(CRED_KYC_OVER18);
        setKyc(
          types.has(CRED_KYC_FULL)   ? "full"   :
          types.has(CRED_KYC_OVER18) ? "over18" : null
        );
        const t = types.has(CRED_TIER2) ? 2 : types.has(CRED_TIER1) ? 1 : null;
        setTier(t);
        if (!hasKyc || !t) setError("You need at least a KYC_OVER18 credential and a credit tier to continue.");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [address]);

  if (loading) return <p className="text-sm text-muted-foreground animate-pulse">Checking eligibility…</p>;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Eligibility check</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Collateralised loans require at minimum a KYC_OVER18 credential and a credit tier.
        </p>
      </div>

      <div className="divide-y border rounded-md text-sm">
        {[
          ["Wallet",    <span className="font-mono text-xs">{address}</span>],
          ["KYC",       kyc
            ? <Badge variant="success">{kyc === "full" ? "KYC Full" : "KYC Over-18"}</Badge>
            : <Badge variant="destructive">Missing</Badge>],
          ["Credit tier", tier
            ? <Badge variant="secondary">Tier {tier} · max {TIER_MAX[tier === 2 ? CRED_TIER2 : CRED_TIER1]} RLUSD</Badge>
            : <Badge variant="destructive">Missing</Badge>],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between px-4 py-3">
            <span className="text-muted-foreground">{k}</span>
            <span>{v}</span>
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
          {error}
          {(!kyc) && (
            <p className="mt-1 text-xs">
              <a href="/onboarding" className="underline">Complete KYC verification →</a>
            </p>
          )}
        </div>
      )}

      {!error && kyc && tier && (
        <>
          <div className="rounded-md bg-muted/50 px-4 py-3 text-sm space-y-1">
            <p className="font-medium">How collateralised loans work</p>
            <ul className="text-muted-foreground text-xs space-y-0.5 list-disc list-inside">
              <li>You lock <strong>125% of the loan amount</strong> in XRP as collateral.</li>
              <li>The platform co-signs your wallet (weight 2 of 2) for enforcement.</li>
              <li>Health is monitored in real-time via the price oracle.</li>
              <li>If health drops below {process.env.NEXT_PUBLIC_COLLATERAL_LIQUIDATION_THRESHOLD ?? 112}%, the position is liquidated.</li>
            </ul>
          </div>
          <Button onClick={onNext} className="w-full">Continue to loan amount</Button>
        </>
      )}
    </div>
  );
}

// ── Step 2 — Loan amount ──────────────────────────────────────────────────────

function StepAmount({ address, onNext }) {
  const [principal,    setPrincipal]    = useState("");
  const [quote,        setQuote]        = useState(null); // API response
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [error,        setError]        = useState(null);

  async function handleQuote(e) {
    e.preventDefault();
    const p = parseFloat(principal);
    if (!p || p <= 0) { setError("Enter a valid amount."); return; }
    setError(null);
    setQuoteLoading(true);
    try {
      const res  = await fetch("/api/loans/collateral/request", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ borrowerAddress: address, loanAmountRLUSD: String(p) }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setQuote(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setQuoteLoading(false);
    }
  }

  const amountReceived  = quote ? (parseFloat(quote.loanAmountRLUSD ?? principal) * (1 - ORIGINATION_FEE_RATE)).toFixed(2) : null;
  const monthlyPayment  = quote ? (parseFloat(quote.loanAmountRLUSD ?? principal) / PAYMENT_TOTAL).toFixed(6) : null;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Loan amount</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Enter the RLUSD amount you wish to borrow. We'll calculate the required XRP collateral.
        </p>
      </div>

      {!quote ? (
        <form onSubmit={handleQuote} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="principal">Principal (RLUSD)</Label>
            <Input
              id="principal"
              type="number"
              min="1"
              step="0.01"
              placeholder="e.g. 500"
              value={principal}
              onChange={(e) => { setPrincipal(e.target.value); setError(null); }}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>}
          <Button type="submit" className="w-full" disabled={quoteLoading}>
            {quoteLoading ? "Fetching oracle price…" : "Calculate collateral"}
          </Button>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="divide-y border rounded-md text-sm">
            {[
              ["Loan principal",      `${parseFloat(principal).toFixed(2)} RLUSD`],
              ["Origination fee",     `8% · ${(parseFloat(principal) * 0.08).toFixed(2)} RLUSD`],
              ["You receive",         `${amountReceived} RLUSD`],
              ["Installments",        `${PAYMENT_TOTAL} × 5-minute payments (devnet)`],
              ["Monthly payment",     `${monthlyPayment} RLUSD`],
              ["XRP price (oracle)",  `$${quote.xrpUsd?.toFixed(4)}`],
              ["Collateral required", <strong>{parseFloat(quote.xrpRequired).toFixed(4)} XRP</strong>],
              ["Initial health",      <Badge variant="success">125.00%</Badge>],
              ["Warning below",       `${process.env.NEXT_PUBLIC_COLLATERAL_WARNING_THRESHOLD ?? 120}%`],
              ["Liquidation below",   `${process.env.NEXT_PUBLIC_COLLATERAL_LIQUIDATION_THRESHOLD ?? 112}%`],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-medium text-right">{v}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setQuote(null)} className="flex-1">Change amount</Button>
            <Button onClick={() => onNext(quote)} className="flex-1">
              {quote.needsMultisigSetup ? "Set up co-signing →" : "Deposit collateral →"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step 3 — Multi-sig setup ──────────────────────────────────────────────────

function StepMultisig({ address, quote, onNext }) {
  const { walletManager } = useWallet();
  const [loading,  setLoading]  = useState(false);
  const [done,     setDone]     = useState(false);
  const [error,    setError]    = useState(null);

  async function handleSetup() {
    setLoading(true);
    setError(null);
    try {
      // 1. Get the SignerListSet txBlob from backend
      const prepRes = await fetch("/api/loans/collateral/multisig", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ borrowerAddress: address, loanRequestId: quote.loanRequestId }),
      });
      const prepData = await prepRes.json();
      if (!prepRes.ok) throw new Error(prepData.error);

      // 2. User signs via Xaman
      await walletManager.signAndSubmit({ txblob: prepData.txBlob });

      // 3. Confirm multisig in store
      await fetch("/api/loans/collateral/multisig", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action: "confirm", loanRequestId: quote.loanRequestId }),
      });

      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Co-signing setup</h2>
        <p className="text-sm text-muted-foreground mt-1">
          One-time setup. You'll sign a <code className="text-xs bg-muted px-1 rounded">SignerListSet</code> that
          adds the platform as co-signer on your wallet, giving it enforcement rights over your collateral.
        </p>
      </div>

      <div className="rounded-md bg-muted/50 px-4 py-4 space-y-3 text-sm">
        <p className="font-medium">What you're signing</p>
        <div className="divide-y border rounded-md">
          {[
            ["Transaction type",  "SignerListSet"],
            ["Account",           <span className="font-mono text-xs">{address}</span>],
            ["SignerQuorum",      "2 (platform can act alone)"],
            ["Platform signer",   "Weight 2 — dominant"],
            ["Your weight",       "Weight 1 — co-guardian"],
            ["Master key",        "Not disabled — Xaman still works normally"],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between px-3 py-2 text-xs">
              <span className="text-muted-foreground">{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          This lets the platform enforce liquidation if your collateral health drops too low.
          Your Xaman wallet continues to work for regular transactions.
        </p>
      </div>

      {error && <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>}

      {!done ? (
        <Button onClick={handleSetup} disabled={loading} className="w-full">
          {loading ? "Waiting for Xaman signature…" : "Sign co-signing setup in Xaman"}
        </Button>
      ) : (
        <div className="space-y-3">
          <div className="rounded-md bg-green-500/10 border border-green-500/30 px-4 py-3 text-sm text-green-700 dark:text-green-400">
            Co-signing configured. The platform is now weight-2 co-signer on your wallet.
          </div>
          <Button onClick={onNext} className="w-full">Deposit collateral →</Button>
        </div>
      )}
    </div>
  );
}

// ── Step 4 — Collateral deposit ───────────────────────────────────────────────

function StepDeposit({ address, quote, onNext }) {
  const { walletManager } = useWallet();
  const [loading,  setLoading]  = useState(false);
  const [txHash,   setTxHash]   = useState(null);
  const [error,    setError]    = useState(null);

  const xrpAmount = parseFloat(quote.xrpRequired).toFixed(4);

  // Encode loanRequestId as hex for the Memo field
  const memoHex = Buffer.from(quote.loanRequestId, "utf8").toString("hex").toUpperCase();

  async function handleDeposit() {
    setLoading(true);
    setError(null);
    try {
      // 1. User sends XRP → escrow via Xaman
      const tx = {
        TransactionType: "Payment",
        Account:         address,
        Destination:     quote.escrowAddress,
        Amount:          quote.xrpDropsRequired,
        Memos: [{
          Memo: {
            MemoType: Buffer.from("collateral/loanRequestId", "utf8").toString("hex").toUpperCase(),
            MemoData: memoHex,
          },
        }],
      };

      const result = await walletManager.signAndSubmit(tx);
      const hash   = result?.hash ?? result?.result?.hash;
      if (!hash) throw new Error("No transaction hash returned from Xaman.");

      // 2. Confirm deposit on-chain
      const confRes = await fetch("/api/loans/collateral/confirm-deposit", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ loanRequestId: quote.loanRequestId, txHash: hash }),
      });
      const confData = await confRes.json();
      if (!confRes.ok) throw new Error(confData.error);

      setTxHash(hash);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Deposit collateral</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Send <strong>{xrpAmount} XRP</strong> to the platform escrow wallet via Xaman.
          The XRP stays locked until your loan is fully repaid.
        </p>
      </div>

      <div className="divide-y border rounded-md text-sm">
        {[
          ["Destination",       <span className="font-mono text-xs">{quote.escrowAddress}</span>],
          ["Amount",            <strong>{xrpAmount} XRP</strong>],
          ["Drops",             quote.xrpDropsRequired],
          ["Memo (auto-set)",   <span className="font-mono text-xs truncate max-w-[200px]">{quote.loanRequestId}</span>],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between px-4 py-2.5">
            <span className="text-muted-foreground">{k}</span>
            <span className="text-right">{v}</span>
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>}

      {!txHash ? (
        <Button onClick={handleDeposit} disabled={loading} className="w-full">
          {loading ? "Waiting for Xaman…" : `Send ${xrpAmount} XRP via Xaman`}
        </Button>
      ) : (
        <div className="space-y-3">
          <div className="rounded-md bg-green-500/10 border border-green-500/30 px-4 py-3 text-sm text-green-700 dark:text-green-400 space-y-1">
            <p className="font-medium">Collateral confirmed on-chain</p>
            <p className="font-mono text-xs break-all opacity-70">tx: {txHash}</p>
          </div>
          <Button onClick={() => onNext(txHash)} className="w-full">Create loan →</Button>
        </div>
      )}
    </div>
  );
}

// ── Step 5 — Loan creation ────────────────────────────────────────────────────

function StepCreateLoan({ address, quote, onNext }) {
  const { walletManager } = useWallet();
  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState(null);
  const [error,    setError]    = useState(null);

  async function handleCreate() {
    setLoading(true);
    setError(null);
    try {
      // 1. Prepare unsigned LoanSet
      const prepRes = await fetch("/api/loans/collateral/prepare", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ borrowerAddress: address, loanRequestId: quote.loanRequestId }),
      });
      const prepData = await prepRes.json();
      if (!prepRes.ok) throw new Error(prepData.error);

      // 2. User signs via Xaman
      const signResult = await walletManager.sign({ txblob: prepData.txBlob });
      const signedBlob = signResult?.signed_tx_blob ?? signResult?.tx_blob ?? signResult;
      if (!signedBlob) throw new Error("No signed blob returned from Xaman.");

      // 3. Broker countersigns + submits
      const finRes = await fetch("/api/loans/collateral/finalize", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ signedBlob, borrowerAddress: address, loanRequestId: quote.loanRequestId }),
      });
      const finData = await finRes.json();
      if (!finRes.ok) throw new Error(finData.error);

      setResult(finData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    const amountReceived = (parseFloat(quote.loanAmountRLUSD ?? 0) * (1 - ORIGINATION_FEE_RATE)).toFixed(2);
    return (
      <div className="space-y-5">
        <div className="rounded-md bg-green-500/10 border border-green-500/30 px-4 py-4 space-y-1">
          <p className="font-semibold text-green-700 dark:text-green-400">Loan created successfully!</p>
          <p className="text-sm text-muted-foreground">
            {amountReceived} RLUSD disbursed · {result.collateralXRP} XRP locked · first payment due {fmtDate(result.nextPaymentDueDate)}.
          </p>
        </div>

        <div className="divide-y border rounded-md text-sm">
          {[
            ["Loan ID",            result.loanId],
            ["Monthly payment",    `${result.periodicPayment} RLUSD`],
            ["Installments",       `${result.paymentsTotal} × 5-minute (devnet)`],
            ["First due",          fmtDate(result.nextPaymentDueDate)],
            ["Collateral locked",  `${result.collateralXRP} XRP`],
            ["LoanSet tx",         result.hash],
          ].map(([k, v]) => (
            <div key={k} className="flex items-start justify-between px-4 py-2 gap-4">
              <span className="text-muted-foreground shrink-0">{k}</span>
              <span className="font-mono text-xs break-all text-right">{v}</span>
            </div>
          ))}
        </div>

        <Button onClick={onNext} className="w-full">View my loans →</Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Create loan</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Sign the loan agreement via Xaman. The broker will countersign server-side and RLUSD will be disbursed instantly.
        </p>
      </div>

      <div className="rounded-md bg-muted/50 px-4 py-4 text-sm space-y-2">
        <p className="font-medium">Summary</p>
        <div className="grid grid-cols-2 gap-y-2 text-xs">
          {[
            ["Borrow",     `${parseFloat(quote.loanAmountRLUSD ?? 0).toFixed(2)} RLUSD`],
            ["Receive",    `${(parseFloat(quote.loanAmountRLUSD ?? 0) * 0.92).toFixed(2)} RLUSD`],
            ["Collateral", `${parseFloat(quote.xrpRequired ?? 0).toFixed(4)} XRP locked`],
            ["Oracle",     `$${quote.xrpUsd?.toFixed(4)} / XRP`],
          ].map(([k, v]) => (
            <div key={k}>
              <p className="text-muted-foreground">{k}</p>
              <p className="font-medium">{v}</p>
            </div>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>}

      <Button onClick={handleCreate} disabled={loading} className="w-full">
        {loading ? "Waiting for Xaman…" : "Sign loan agreement in Xaman"}
      </Button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NewCollateralLoanPage() {
  const router = useRouter();
  const { isConnected, accountInfo } = useWallet();

  const address = isConnected ? accountInfo?.address : null;

  const [step,  setStep]  = useState(1);
  const [quote, setQuote] = useState(null); // from /api/loans/collateral/request

  if (!isConnected || !address) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Connect your wallet to continue.</p>
      </div>
    );
  }

  function handleAmountNext(quoteData) {
    setQuote(quoteData);
    setStep(quoteData.needsMultisigSetup ? 3 : 4);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1">
        <div className="container py-8 max-w-xl">

          <div className="mb-6 flex items-center gap-3">
            <button
              onClick={() => router.push("/loans")}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Back to loans
            </button>
          </div>

          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">New Collateralised Loan</h1>
            <p className="text-muted-foreground text-sm mt-1">
              XRP collateral · RLUSD loan · On-chain enforcement
            </p>
          </div>

          <StepBar current={step} />

          <div className="rounded-lg border p-6">
            {step === 1 && (
              <StepEligibility address={address} onNext={() => setStep(2)} />
            )}
            {step === 2 && (
              <StepAmount address={address} onNext={handleAmountNext} />
            )}
            {step === 3 && quote && (
              <StepMultisig address={address} quote={quote} onNext={() => setStep(4)} />
            )}
            {step === 4 && quote && (
              <StepDeposit address={address} quote={quote} onNext={() => setStep(5)} />
            )}
            {step === 5 && quote && (
              <StepCreateLoan address={address} quote={quote} onNext={() => router.push("/loans")} />
            )}
          </div>
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
