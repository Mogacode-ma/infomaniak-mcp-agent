/**
 * Confirmation token store — implements the agentic two-phase commit
 * pattern for destructive operations.
 *
 * Phase 1 (plan): the tool is called without a token.
 *   It returns a description of what would happen, plus a fresh
 *   single-use confirmation_token valid for ~60 seconds.
 *
 * Phase 2 (apply): the tool is called again with the same token.
 *   The token is consumed and the operation is executed.
 *
 * Tokens are stored in memory only. Restarting the server invalidates
 * all pending confirmations (intentional — encourages explicit re-plan).
 */
import { randomUUID } from "node:crypto";

import { InfomaniakError } from "../api/errors.js";
import { loadConfig } from "../config.js";

interface TokenRecord {
  /** Unique opaque identifier shown to the user / agent. */
  token: string;
  /** Stable signature of the operation (tool name + sorted params hash). */
  fingerprint: string;
  /** Wall-clock expiry. */
  expiresAt: number;
}

const records = new Map<string, TokenRecord>();

/**
 * Mints a new single-use token for an operation fingerprint.
 *
 * The fingerprint should be a deterministic representation of the operation
 * (e.g. `${toolName}:${JSON.stringify(sortedParams)}`) so that a different
 * operation cannot reuse a previously-issued token.
 */
export function mintToken(fingerprint: string): { token: string; expiresAt: Date } {
  const config = loadConfig();
  if (config.INFOMANIAK_READ_ONLY) {
    throw readOnlyError();
  }
  purge();
  const ttlMs = config.CONFIRMATION_TTL_SECONDS * 1000;
  const token = randomUUID();
  const expiresAt = Date.now() + ttlMs;
  records.set(token, { token, fingerprint, expiresAt });
  return { token, expiresAt: new Date(expiresAt) };
}

/**
 * Consumes a token if it matches the operation fingerprint and hasn't
 * expired. Returns true on success (token now spent), false otherwise.
 *
 * On a fingerprint mismatch the token is preserved so that the legitimate
 * caller can still use it; only successful matches consume it.
 */
export function consumeToken(token: string, fingerprint: string): boolean {
  purge();
  const record = records.get(token);
  if (!record) {
    return false;
  }
  if (record.fingerprint !== fingerprint) {
    return false;
  }
  records.delete(token);
  return true;
}

/**
 * Error for a change refused because `INFOMANIAK_READ_ONLY` is set. Raised when a
 * plan is requested, so the agent hears "no" before it asks the user to confirm.
 */
export function readOnlyError(): InfomaniakError {
  return new InfomaniakError({
    message: "INFOMANIAK_READ_ONLY is set: this server refuses requests that change the account.",
    code: "read_only_mode",
    actionable: "Unset INFOMANIAK_READ_ONLY and restart the server to allow changes.",
  });
}

/** Drop expired tokens — called opportunistically. */
function purge(): void {
  const now = Date.now();
  for (const [token, record] of records) {
    if (record.expiresAt < now) {
      records.delete(token);
    }
  }
}

/** @internal — for tests only. */
export function _resetTokens(): void {
  records.clear();
}
