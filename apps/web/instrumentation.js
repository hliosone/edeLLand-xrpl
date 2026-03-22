/**
 * Next.js instrumentation hook — runs once at server startup (Node.js runtime only).
 *
 * Sets up two server-side intervals:
 *
 *  1. Collateral monitor  — every 5 min
 *     Checks all active collateral positions, auto-liquidates those below the
 *     liquidation threshold, auto-releases fully-repaid positions.
 *
 *  2. Oracle price push   — every 2 min
 *     Re-publishes a live XRP/USD price to the on-chain oracle so the
 *     health calculations always use a fresh price.
 *
 * Both jobs run entirely server-side, independent of any page visit.
 */

export async function register() {
  // Only run in the Node.js runtime (not in the Edge runtime or during build)
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const COLLATERAL_MONITOR_INTERVAL_MS = 15 * 1_000;      // 15 seconds
  const ORACLE_PUSH_INTERVAL_MS        = 2  * 60 * 1_000; //  2 minutes

  // ── Helper: internal fetch against the local Next.js server ────────────────
  // We import the route handlers directly rather than doing an HTTP round-trip.

  async function runCollateralMonitor() {
    try {
      const { Client, Wallet } = await import("xrpl");
      const store = await import("./lib/collateral-store.js");

      const positions = store.getAllActive();
      if (!positions.length) return;

      const endpoint      = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";
      const oracleAccount = process.env.NEXT_PUBLIC_ORACLE_ADDRESS;
      const oracleDocId   = parseInt(process.env.NEXT_PUBLIC_ORACLE_DOCUMENT_ID ?? "1", 10);
      const escrowSeed    = process.env.COLLATERAL_ESCROW_WALLET_SEED;
      const brokerSeed    = process.env.LOAN_BROKER_WALLET_SEED ?? process.env.PLATFORM_ISSUER_WALLET_SEED;

      const WARNING_THRESHOLD     = parseFloat(process.env.COLLATERAL_WARNING_THRESHOLD     ?? "120");
      const LIQUIDATION_THRESHOLD = parseFloat(process.env.COLLATERAL_LIQUIDATION_THRESHOLD ?? "112");

      const client = new Client(endpoint);
      await client.connect();

      try {
        // Fetch XRP/USD price
        let xrpUsd = null;
        if (oracleAccount) {
          try {
            const r = await client.request({
              command:      "get_aggregate_price",
              ledger_index: "current",
              base_asset:   "XRP",
              quote_asset:  "USD",
              oracles:      [{ account: oracleAccount, oracle_document_id: oracleDocId }],
            });
            xrpUsd = parseFloat(r.result.entire_set?.mean);
          } catch {}
        }
        if (!xrpUsd) {
          try {
            const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=XRPUSDT");
            xrpUsd  = parseFloat((await r.json()).price);
          } catch {}
        }
        if (!xrpUsd) {
          console.warn("[cron/collateral] Cannot fetch XRP price — skipping monitor run.");
          return;
        }

        const escrowWallet = escrowSeed ? Wallet.fromSeed(escrowSeed) : null;
        const brokerWallet = brokerSeed ? Wallet.fromSeed(brokerSeed) : null;

        for (const pos of positions) {
          let outstandingRLUSD = parseFloat(pos.loanAmountRLUSD);
          let loanRepaid       = false;

          if (pos.loanId) {
            try {
              const le   = await client.request({ command: "ledger_entry", index: pos.loanId, ledger_index: "validated" });
              const loan = le.result.node;
              if (loan?.PaymentRemaining === 0) {
                loanRepaid       = true;
                outstandingRLUSD = 0;
              } else {
                outstandingRLUSD = parseFloat(loan?.TotalValueOutstanding ?? outstandingRLUSD);
              }
            } catch {}
          }

          // Auto-release fully repaid loans
          if (loanRepaid) {
            if (escrowWallet) {
              try {
                await client.submitAndWait({
                  TransactionType: "Payment",
                  Account:         escrowWallet.address,
                  Destination:     pos.userAddress,
                  Amount:          pos.xrpDrops,
                }, { autofill: true, wallet: escrowWallet });
                console.log(`[cron/collateral] Released collateral for ${pos.loanRequestId} → ${pos.userAddress}`);
              } catch (e) {
                console.error(`[cron/collateral] Release failed for ${pos.loanRequestId}:`, e.message);
              }
            }
            store.releaseLoan(pos.loanRequestId);
            continue;
          }

          const xrpLocked = parseInt(pos.xrpDrops) / 1_000_000;
          const health    = outstandingRLUSD > 0
            ? (xrpLocked * xrpUsd) / outstandingRLUSD * 100
            : null;

          if (health !== null && health < LIQUIDATION_THRESHOLD) {
            console.warn(`[cron/collateral] LIQUIDATING ${pos.loanRequestId} — health ${health.toFixed(2)}% < ${LIQUIDATION_THRESHOLD}%`);

            if (escrowWallet) {
              try {
                const dest = brokerWallet?.address ?? escrowWallet.address;
                await client.submitAndWait({
                  TransactionType: "Payment",
                  Account:         escrowWallet.address,
                  Destination:     dest,
                  Amount:          pos.xrpDrops,
                }, { autofill: true, wallet: escrowWallet });
              } catch (e) {
                console.error(`[cron/collateral] Sweep failed for ${pos.loanRequestId}:`, e.message);
              }

              if (brokerWallet && pos.loanId) {
                try {
                  await client.submitAndWait({
                    TransactionType: "LoanManage",
                    Account:         brokerWallet.address,
                    LoanID:          pos.loanId,
                    Flags:           0x00010000,
                  }, { autofill: true, wallet: brokerWallet });
                } catch (e) {
                  console.warn(`[cron/collateral] LoanManage default failed (grace period?):`, e.message);
                }
              }
            }

            store.liquidateLoan(pos.loanRequestId);
          } else if (health !== null && health < WARNING_THRESHOLD) {
            console.log(`[cron/collateral] WARNING ${pos.loanRequestId} — health ${health.toFixed(2)}%`);
          }
        }
      } finally {
        await client.disconnect();
      }
    } catch (err) {
      console.error("[cron/collateral] Monitor error:", err.message);
    }
  }

  async function runOraclePush() {
    try {
      const seed = process.env.ORACLE_ADMIN_WALLET_SEED;
      if (!seed) return; // oracle not configured

      const { Client, Wallet, convertStringToHex } = await import("xrpl");

      const SCALE        = 6;
      const ORACLE_DOC_ID = parseInt(process.env.NEXT_PUBLIC_ORACLE_DOCUMENT_ID ?? "1", 10);

      // Fetch live XRP price
      let xrpPrice = null;
      try {
        const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=XRPUSDT");
        xrpPrice = parseFloat((await r.json()).price);
      } catch {}
      if (!xrpPrice) {
        try {
          const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ripple&vs_currencies=usd");
          xrpPrice = (await r.json())?.ripple?.usd;
        } catch {}
      }
      if (!xrpPrice || isNaN(xrpPrice)) {
        console.warn("[cron/oracle] Cannot fetch live price — skipping push.");
        return;
      }

      const endpoint = process.env.XRPL_NETWORK_ENDPOINT ?? "wss://s.devnet.rippletest.net:51233";
      const oracle   = Wallet.fromSeed(seed);
      const client   = new Client(endpoint);
      await client.connect();

      try {
        // LastUpdateTime = Unix timestamp (seconds since 1970), same as setup-oracle.mjs
        const lastUpdateTime = Math.floor(Date.now() / 1000);

        const res = await client.submitAndWait({
          TransactionType:  "OracleSet",
          Account:          oracle.address,
          OracleDocumentID: ORACLE_DOC_ID,
          Provider:         convertStringToHex("edeLLand"),
          AssetClass:       convertStringToHex("currency"),
          LastUpdateTime:   lastUpdateTime,
          PriceDataSeries: [{
            PriceData: {
              BaseAsset:  "XRP",
              QuoteAsset: "USD",
              AssetPrice: Math.round(xrpPrice * Math.pow(10, SCALE)),
              Scale:      SCALE,
            },
          }],
        }, { autofill: true, wallet: oracle });

        if (res.result.meta?.TransactionResult === "tesSUCCESS") {
          console.log(`[cron/oracle] XRP/USD updated → $${xrpPrice}`);
        }
      } finally {
        await client.disconnect();
      }
    } catch (err) {
      console.error("[cron/oracle] Push error:", err.message);
    }
  }

  // ── Start intervals ─────────────────────────────────────────────────────────

  // Run immediately on startup, then on schedule
  runCollateralMonitor();
  runOraclePush();

  setInterval(runCollateralMonitor, COLLATERAL_MONITOR_INTERVAL_MS);
  setInterval(runOraclePush,        ORACLE_PUSH_INTERVAL_MS);

  console.log("[instrumentation] Collateral monitor started (every 15 s)");
  console.log("[instrumentation] Oracle price push started (every 2 min)");
}
