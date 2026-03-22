"use client";

import { useState, useCallback } from "react";
import QRCode from "qrcode";
import { startVerification, watchVerification } from "../scripts/edel-id/verification";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

const STATUS = {
  IDLE: "idle",
  LOADING: "loading",
  WAITING: "waiting",
  SUCCESS: "success",
  FAILED: "failed",
};

export function EdelIDVerification() {
  const [status, setStatus] = useState(STATUS.IDLE);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [claims, setClaims] = useState(null);
  const [error, setError] = useState(null);

  const handleVerify = useCallback(async () => {
    setStatus(STATUS.LOADING);
    setError(null);
    setClaims(null);
    setQrDataUrl(null);

    try {
      const { id, verification_url } = await startVerification();
      const qr = await QRCode.toDataURL(verification_url, { width: 220, margin: 2 });
      setQrDataUrl(qr);
      setStatus(STATUS.WAITING);

      const result = await watchVerification(id, () => {});

      if (result.state === "SUCCESS") {
        const merged = Object.assign({}, ...(result.verifiedClaims ?? []));
        setClaims(merged);
        setStatus(STATUS.SUCCESS);
      } else {
        setError("Verification failed or was rejected.");
        setStatus(STATUS.FAILED);
      }
    } catch (err) {
      setError(err.message);
      setStatus(STATUS.FAILED);
    } finally {
      setQrDataUrl(null);
    }
  }, []);

  const handleReset = () => {
    setStatus(STATUS.IDLE);
    setClaims(null);
    setQrDataUrl(null);
    setError(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Identity Verification
          {status === STATUS.SUCCESS && <Badge variant="success">Verified</Badge>}
          {status === STATUS.FAILED && <Badge variant="destructive">Failed</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === STATUS.IDLE && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Verify your identity with Edel-ID to confirm your name, age (18+) and nationality.
            </p>
            <Button onClick={handleVerify} className="w-full">
              Verify with Edel-ID
            </Button>
          </div>
        )}

        {status === STATUS.LOADING && (
          <p className="text-sm text-muted-foreground animate-pulse">Starting verification...</p>
        )}

        {status === STATUS.WAITING && qrDataUrl && (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-muted-foreground text-center">
              Scan this QR code with the Edel-ID app
            </p>
            <img src={qrDataUrl} alt="Edel-ID QR Code" className="rounded-lg border" />
            <p className="text-xs text-muted-foreground animate-pulse">Waiting for confirmation...</p>
          </div>
        )}

        {status === STATUS.SUCCESS && claims && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Verified claims:</p>
            <div className="rounded-md border divide-y text-sm">
              {claims.given_name && (
                <div className="flex justify-between px-3 py-2">
                  <span className="text-muted-foreground">First name</span>
                  <span className="font-medium">{claims.given_name}</span>
                </div>
              )}
              {claims.family_name && (
                <div className="flex justify-between px-3 py-2">
                  <span className="text-muted-foreground">Last name</span>
                  <span className="font-medium">{claims.family_name}</span>
                </div>
              )}
              {claims.age_over_18 !== undefined && (
                <div className="flex justify-between px-3 py-2">
                  <span className="text-muted-foreground">Age 18+</span>
                  <Badge variant={claims.age_over_18 === "true" ? "success" : "destructive"}>
                    {claims.age_over_18 === "true" ? "Yes" : "No"}
                  </Badge>
                </div>
              )}
              {claims.nationality && (
                <div className="flex justify-between px-3 py-2">
                  <span className="text-muted-foreground">Nationality</span>
                  <span className="font-medium">{claims.nationality}</span>
                </div>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={handleReset} className="w-full mt-2">
              Verify again
            </Button>
          </div>
        )}

        {status === STATUS.FAILED && (
          <div className="space-y-3">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" onClick={handleReset} className="w-full">
              Try again
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
