import { Client } from "xrpl";
import { writeEnvVars } from "./env-writer.mjs";

const DEVNET_WSS    = "wss://s.devnet.rippletest.net:51233";
const DEVNET_FAUCET = "faucet.devnet.rippletest.net";

// If XRPL_NETWORK_ENDPOINT is already set (e.g. pointing to a local node),
// use it; otherwise default to devnet. For local nodes (localhost) xrpl.js
// auto-detects the faucet, so we skip the explicit faucetHost.
const NETWORK_WSS = process.env.XRPL_NETWORK_ENDPOINT ?? DEVNET_WSS;
const isLocal     = NETWORK_WSS.includes("localhost") || NETWORK_WSS.includes("127.0.0.1");

const WALLETS = [
  { label: "Platform Issuer",    envPrefix: "PLATFORM_ISSUER_WALLET"    },
  { label: "Platform Broker",    envPrefix: "PLATFORM_BROKER_WALLET"    },
  { label: "RLUSD Issuer",       envPrefix: "RLUSD_ISSUER_WALLET"       },
  { label: "Oracle Admin",       envPrefix: "ORACLE_ADMIN_WALLET"       },
  { label: "Collateral Escrow",  envPrefix: "COLLATERAL_ESCROW_WALLET"  },
];

/**
 * Generates and funds all platform wallets on devnet.
 * Writes per-wallet ADDRESS + SEED to .env.local, plus XRPL_NETWORK_ENDPOINT.
 *
 * @param {object} ctx - shared setup context (populated for downstream steps)
 */
export async function createAccounts(ctx) {
  console.log(`\n[create-accounts] Connecting to ${NETWORK_WSS}...`);

  const client = new Client(NETWORK_WSS);
  await client.connect();

  // Write the network endpoint first so all subsequent scripts can read it
  writeEnvVars({ XRPL_NETWORK_ENDPOINT: NETWORK_WSS });

  for (const { label, envPrefix } of WALLETS) {
    console.log(`\n  Funding ${label}...`);

    const faucetPort = process.env.FAUCET_PORT ?? "7007"
    const fundOpts = isLocal
      ? { faucetHost: `localhost:${faucetPort}`, faucetPath: "/accounts", faucetProtocol: "http" }
      : { faucetHost: DEVNET_FAUCET };

    // Retry up to 3 times with a 4 s back-off (devnet faucet rate-limits rapid calls)
    let wallet;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        ({ wallet } = await client.fundWallet(null, fundOpts));
        break;
      } catch (err) {
        if (attempt === 3) throw err;
        console.log(`    ⚠ faucet error (attempt ${attempt}/3): ${err.message} — retrying in 4 s…`);
        await new Promise((r) => setTimeout(r, 4_000));
      }
    }
    const balance = await client.getXrpBalance(wallet.address);

    console.log(`    Address : ${wallet.address}`);
    console.log(`    Seed    : ${wallet.seed}`);
    console.log(`    Balance : ${balance} XRP`);

    writeEnvVars({
      [`${envPrefix}_ADDRESS`]: wallet.address,
      [`${envPrefix}_SEED`]:    wallet.seed,
    });

    // Expose on ctx so downstream steps can reference wallets by role
    ctx[envPrefix] = wallet;

    // Small pause between fundings to avoid faucet rate-limits
    if (!isLocal) await new Promise((r) => setTimeout(r, 2_000));
  }

  await client.disconnect();
}
