/**
 * lib/ofac.js — AML / OFAC Screening
 *
 * Sanctions list persisted to data/ofac-list.json.
 * Audit log is in-memory (newest 500 entries).
 *
 * Usage:
 *   import { isBlocked, addAddress, removeAddress, getList, getLog } from "@/lib/ofac";
 */

import fs   from "fs";
import path from "path";

const LIST_PATH = path.join(process.cwd(), "data", "ofac-list.json");

// ── Persistence helpers ───────────────────────────────────────────────────────

function _loadList() {
  try {
    return JSON.parse(fs.readFileSync(LIST_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function _saveList(list) {
  try {
    fs.mkdirSync(path.dirname(LIST_PATH), { recursive: true });
    fs.writeFileSync(LIST_PATH, JSON.stringify(list, null, 2));
  } catch (err) {
    console.error("[AML/OFAC] Failed to persist list:", err.message);
  }
}

// ── State ─────────────────────────────────────────────────────────────────────

let _list = _loadList();
const _log = [];

// ── Audit log ─────────────────────────────────────────────────────────────────

function _logEntry(action, address, extra = {}) {
  const entry = { at: new Date().toISOString(), action, address, ...extra };
  _log.unshift(entry);          // newest first
  if (_log.length > 500) _log.pop();
  console.log(`[AML/OFAC] ${action.padEnd(11)} ${address}${extra.label ? `  "${extra.label}"` : ""}${extra.action_by ? `  by=${extra.action_by}` : ""}`);
  return entry;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check if an address is sanctioned.
 * Logs every hit (BLOCK) — clean passes are NOT logged to avoid log spam.
 * @param {string} address
 * @param {{ action?: string, logClean?: boolean }} options
 */
export function isBlocked(address, { action = "CHECK", logClean = false } = {}) {
  const hit = _list.find(e => e.address === address);
  if (hit) {
    _logEntry("BLOCK", address, { label: hit.label, source: hit.source, trigger: action });
    return { blocked: true, ...hit };
  }
  if (logClean) _logEntry("CHECK", address, { trigger: action, result: "clean" });
  return { blocked: false };
}

/**
 * Add an address to the sanctions list.
 * Throws if already present.
 */
export function addAddress({ address, label, source = "MANUAL", addedBy = "admin" }) {
  if (!address) throw new Error("address is required");
  if (_list.find(e => e.address === address)) throw new Error("Address already on list");
  const entry = { address, label: label || "—", source, addedAt: new Date().toISOString().slice(0, 10) };
  _list.push(entry);
  _saveList(_list);
  _logEntry("ADD", address, { label: entry.label, source, action_by: addedBy });
  return entry;
}

/**
 * Remove an address from the sanctions list.
 * Returns the removed entry or throws if not found.
 */
export function removeAddress(address, { removedBy = "admin" } = {}) {
  const idx = _list.findIndex(e => e.address === address);
  if (idx === -1) throw new Error("Address not found on list");
  const [removed] = _list.splice(idx, 1);
  _saveList(_list);
  _logEntry("REMOVE", address, { label: removed.label, action_by: removedBy });
  return removed;
}

/** Current list snapshot (shallow copy) */
export function getList() {
  return [..._list];
}

/** Audit log snapshot */
export function getLog(limit = 100) {
  return _log.slice(0, limit);
}
