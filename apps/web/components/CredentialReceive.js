"use client";

import { useState, useCallback } from "react";
import { useWallet } from "./providers/WalletProvider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { CheckCircle2, XCircle, ShieldCheck, Loader2 } from "lucide-react";

const STEP = {
  IDLE: "idle",
  ISSUING: "issuing",
  ISSUED: "issued",
  ACCEPTING: "accepting",
  DONE: "done",
  ERROR: "error",
};

const ISSUER = process.env.NEXT_PUBLIC_CREDENTIAL_ISSUER;
const CREDENTIAL_TYPE = process.env.NEXT_PUBLIC_CREDENTIAL_TYPE || "4B59435F4F4E45";

export function CredentialReceive() {
  const { walletManager, isConnected, accountInfo, addEvent, showStatus } = useWallet();
  const [step, setStep] = useState(STEP.IDLE);
  const [issueTxHash, setIssueTxHash] = useState(null);
  const [acceptTxHash, setAcceptTxHash] = useState(null);
  const [error, setError] = useState(null);

  const handleIssue = useCallback(async () => {
    if (!accountInfo?.address) return;

    setStep(STEP.ISSUING);
    setError(null);
    setIssueTxHash(null);
    setAcceptTxHash(null);

    try {
      const res = await fetch("/api/credential/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectAddress: accountInfo.address }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to issue credential");
      }

      setIssueTxHash(data.txHash);
      addEvent("CredentialCreate", data);
      setStep(STEP.ISSUED);
    } catch (err) {
      setError(err.message);
      setStep(STEP.ERROR);
    }
  }, [accountInfo, addEvent]);

  const handleAccept = useCallback(async () => {
    if (!accountInfo?.address) return;

    setStep(STEP.ACCEPTING);

    try {
      const tx = {
        TransactionType: "CredentialAccept",
        Account: accountInfo.address,
        Issuer: ISSUER,
        CredentialType: CREDENTIAL_TYPE,
      };

      const result = await walletManager.signAndSubmit(tx);

      setAcceptTxHash(result.hash || result.id || "pending");
      addEvent("CredentialAccept", result);
      showStatus("Credential accepted!", "success");
      setStep(STEP.DONE);
    } catch (err) {
      setError(err.message);
      showStatus(`CredentialAccept failed: ${err.message}`, "error");
      setStep(STEP.ERROR);
    }
  }, [walletManager, accountInfo, addEvent, showStatus]);

  const handleReset = () => {
    setStep(STEP.IDLE);
    setIssueTxHash(null);
    setAcceptTxHash(null);
    setError(null);
  };

  if (!isConnected) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" />
          KYC Credential
          {step === STEP.DONE && <Badge variant="success">Accepted</Badge>}
        </CardTitle>
        <CardDescription>Receive and accept a KYC credential on-chain</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {step === STEP.IDLE && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The platform issuer will create a KYC credential for your address. You will then be
              asked to sign an acceptance transaction.
            </p>
            <div className="rounded-md border p-3 space-y-1 text-xs text-muted-foreground font-mono">
              <div className="flex justify-between">
                <span>Issuer</span>
                <span className="truncate max-w-[180px]">{ISSUER}</span>
              </div>
              <div className="flex justify-between">
                <span>Type</span>
                <span>{CREDENTIAL_TYPE}</span>
              </div>
            </div>
            <Button onClick={handleIssue} className="w-full">
              Receive KYC Credential
            </Button>
          </div>
        )}

        {step === STEP.ISSUING && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Issuing credential on-chain...
          </div>
        )}

        {step === STEP.ISSUED && (
          <div className="space-y-3">
            <Alert variant="success">
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Credential Issued</AlertTitle>
              <AlertDescription>
                <p className="text-xs font-mono break-all mt-1">Hash: {issueTxHash}</p>
              </AlertDescription>
            </Alert>
            <p className="text-sm text-muted-foreground">
              The credential is waiting for your acceptance. Sign the{" "}
              <code className="text-xs bg-muted px-1 rounded">CredentialAccept</code> transaction
              with your wallet.
            </p>
            <Button onClick={handleAccept} className="w-full">
              Accept Credential
            </Button>
          </div>
        )}

        {step === STEP.ACCEPTING && (
          <div className="space-y-3">
            <Alert variant="success">
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Credential Issued</AlertTitle>
              <AlertDescription>
                <p className="text-xs font-mono break-all mt-1">Hash: {issueTxHash}</p>
              </AlertDescription>
            </Alert>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Waiting for wallet signature...
            </div>
          </div>
        )}

        {step === STEP.DONE && (
          <div className="space-y-3">
            <Alert variant="success">
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Credential Accepted</AlertTitle>
              <AlertDescription className="space-y-1 mt-1">
                <p className="text-xs">
                  <span className="text-muted-foreground">Issue tx: </span>
                  <span className="font-mono break-all">{issueTxHash}</span>
                </p>
                <p className="text-xs">
                  <span className="text-muted-foreground">Accept tx: </span>
                  <span className="font-mono break-all">{acceptTxHash}</span>
                </p>
              </AlertDescription>
            </Alert>
            <Button variant="outline" size="sm" onClick={handleReset} className="w-full">
              Reset
            </Button>
          </div>
        )}

        {step === STEP.ERROR && (
          <div className="space-y-3">
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <Button variant="outline" onClick={handleReset} className="w-full">
              Try again
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
