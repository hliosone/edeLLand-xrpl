"use client";

import { useEffect, useRef } from "react";
import { useWallet } from "../components/providers/WalletProvider";

// Track managers whose signAndSubmit has already been patched
const patchedManagers = new WeakSet();

export function useWalletConnector(walletManager) {
  const walletConnectorRef = useRef(null);
  const { addEvent, showStatus } = useWallet();

  useEffect(() => {
    if (!walletConnectorRef.current || !walletManager) return;

    const setupConnector = async () => {
      // Wait for custom element to be defined and upgraded
      await customElements.whenDefined("xrpl-wallet-connector");

      // Small delay to ensure the element is fully initialized
      await new Promise((resolve) => setTimeout(resolve, 0));

      if (
        walletConnectorRef.current &&
        typeof walletConnectorRef.current.setWalletManager === "function"
      ) {
        walletConnectorRef.current.setWalletManager(walletManager);

        // Auto-close the Xaman popup once a tx is signed/rejected
        if (!patchedManagers.has(walletManager) && typeof walletManager.signAndSubmit === "function") {
          patchedManagers.add(walletManager);
          const _orig = walletManager.signAndSubmit.bind(walletManager);
          walletManager.signAndSubmit = async (tx) => {
            try {
              const result = await _orig(tx);
              walletConnectorRef.current?.close();
              return result;
            } catch (err) {
              walletConnectorRef.current?.close();
              throw err;
            }
          };
        }

        // Listen to connector events
        const handleConnecting = (e) => {
          showStatus(`Connecting to ${e.detail.walletId}...`, "info");
        };

        const handleConnected = (e) => {
          showStatus("Connected successfully!", "success");
          addEvent("Connected via Web Component", e.detail);
        };

        const handleError = (e) => {
          showStatus(`Connection failed: ${e.detail.error.message}`, "error");
          addEvent("Connection Error", e.detail);
        };

        walletConnectorRef.current.addEventListener("connecting", handleConnecting);
        walletConnectorRef.current.addEventListener("connected", handleConnected);
        walletConnectorRef.current.addEventListener("error", handleError);

        return () => {
          if (walletConnectorRef.current) {
            walletConnectorRef.current.removeEventListener("connecting", handleConnecting);
            walletConnectorRef.current.removeEventListener("connected", handleConnected);
            walletConnectorRef.current.removeEventListener("error", handleError);
          }
        };
      }
    };

    setupConnector();
  }, [walletManager, addEvent, showStatus]);

  return walletConnectorRef;
}
