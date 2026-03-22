/**
 * Collateral position store — file-backed JSON (persists across Next.js hot-reloads).
 *
 * Schema per entry:
 * {
 *   userAddress:     string   — XRPL borrower address
 *   xrpDrops:        string   — locked XRP in drops (string to avoid precision loss)
 *   loanAmountRLUSD: string   — principal the collateral backs
 *   status:          'pending_multisig' | 'pending_deposit' | 'deposit_confirmed'
 *                  | 'active' | 'released' | 'liquidated'
 *   depositTxHash:   string|null
 *   loanId:          string|null — XRPL Loan object index, filled after LoanSet
 *   multisigDone:    boolean  — true once the user has signed the SignerListSet
 *   createdAt:       number   — Unix ms
 *   updatedAt:       number   — Unix ms
 * }
 *
 * Keyed by loanRequestId (UUID).
 */

import fs   from "fs";
import path from "path";

// ── Storage path ──────────────────────────────────────────────────────────────

const DATA_DIR  = path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "collateral-positions.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readStore() {
  ensureDir();
  if (!fs.existsSync(STORE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeStore(data) {
  ensureDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), "utf8");
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a new pending collateral request.
 * Returns the new entry.
 */
export function createRequest({ loanRequestId, userAddress, xrpDrops, loanAmountRLUSD }) {
  const store = readStore();
  const now   = Date.now();
  store[loanRequestId] = {
    userAddress,
    xrpDrops:        String(xrpDrops),
    loanAmountRLUSD: String(loanAmountRLUSD),
    status:          "pending_multisig",
    depositTxHash:   null,
    loanId:          null,
    multisigDone:    false,
    createdAt:       now,
    updatedAt:       now,
  };
  writeStore(store);
  return store[loanRequestId];
}

/**
 * Mark the multi-sig setup as complete for a request.
 */
export function confirmMultisig(loanRequestId) {
  const store = readStore();
  if (!store[loanRequestId]) throw new Error(`Unknown loanRequestId: ${loanRequestId}`);
  store[loanRequestId].multisigDone = true;
  store[loanRequestId].status       = "pending_deposit";
  store[loanRequestId].updatedAt    = Date.now();
  writeStore(store);
  return store[loanRequestId];
}

/**
 * Confirm that the XRP deposit TX has been validated on-chain.
 */
export function confirmDeposit(loanRequestId, depositTxHash) {
  const store = readStore();
  if (!store[loanRequestId]) throw new Error(`Unknown loanRequestId: ${loanRequestId}`);
  store[loanRequestId].depositTxHash = depositTxHash;
  store[loanRequestId].status        = "deposit_confirmed";
  store[loanRequestId].updatedAt     = Date.now();
  writeStore(store);
  return store[loanRequestId];
}

/**
 * Link the on-chain LoanId once the LoanSet is finalised.
 */
export function activateLoan(loanRequestId, loanId) {
  const store = readStore();
  if (!store[loanRequestId]) throw new Error(`Unknown loanRequestId: ${loanRequestId}`);
  store[loanRequestId].loanId    = loanId;
  store[loanRequestId].status    = "active";
  store[loanRequestId].updatedAt = Date.now();
  writeStore(store);
  return store[loanRequestId];
}

/**
 * Mark a position as released (collateral returned to borrower after full repayment).
 */
export function releaseLoan(loanRequestId) {
  const store = readStore();
  if (!store[loanRequestId]) throw new Error(`Unknown loanRequestId: ${loanRequestId}`);
  store[loanRequestId].status    = "released";
  store[loanRequestId].updatedAt = Date.now();
  writeStore(store);
  return store[loanRequestId];
}

/**
 * Mark a position as liquidated.
 */
export function liquidateLoan(loanRequestId) {
  const store = readStore();
  if (!store[loanRequestId]) throw new Error(`Unknown loanRequestId: ${loanRequestId}`);
  store[loanRequestId].status    = "liquidated";
  store[loanRequestId].updatedAt = Date.now();
  writeStore(store);
  return store[loanRequestId];
}

/**
 * Get a single entry by loanRequestId.
 */
export function getById(loanRequestId) {
  return readStore()[loanRequestId] ?? null;
}

/**
 * Get all active (non-released, non-liquidated) positions for a user.
 */
export function getActiveByUser(userAddress) {
  const store = readStore();
  return Object.entries(store)
    .filter(([, v]) => v.userAddress === userAddress && !["released","liquidated"].includes(v.status))
    .map(([id, v]) => ({ loanRequestId: id, ...v }));
}

/**
 * Get all positions for a user (any status).
 */
export function getAllByUser(userAddress) {
  const store = readStore();
  return Object.entries(store)
    .filter(([, v]) => v.userAddress === userAddress)
    .map(([id, v]) => ({ loanRequestId: id, ...v }));
}

/**
 * Get all active positions across all users (for monitor/cron).
 */
export function getAllActive() {
  const store = readStore();
  return Object.entries(store)
    .filter(([, v]) => v.status === "active")
    .map(([id, v]) => ({ loanRequestId: id, ...v }));
}

/**
 * Check whether a user has already set up the multi-sig (any position).
 */
export function hasMultisigSetup(userAddress) {
  const store = readStore();
  return Object.values(store).some(
    (v) => v.userAddress === userAddress && v.multisigDone
  );
}

/**
 * Find the confirmed (not yet active) position for a user — used during loan creation.
 */
export function getConfirmedDepositForUser(userAddress) {
  const store = readStore();
  const entry = Object.entries(store).find(
    ([, v]) => v.userAddress === userAddress && v.status === "deposit_confirmed"
  );
  return entry ? { loanRequestId: entry[0], ...entry[1] } : null;
}
