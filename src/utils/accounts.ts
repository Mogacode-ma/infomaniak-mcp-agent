/**
 * Account discovery helper.
 *
 * Several `list_*` tools require an `account_id` to scope the query.
 * Agents calling the MCP often don't know what account_ids are valid,
 * and the API never tells them where to look. This helper caches the
 * list of accounts the token can reach so the tool layer can default
 * to the first one (or scan them all).
 *
 * Cache is per-process and lives for the MCP session. Refresh by
 * restarting the server (which is what the agent does on token change).
 */
import { PublicApiClient } from "../api/http.js";

let cached: number[] | null = null;
let cachedAt = 0;
const TTL_MS = 5 * 60 * 1000;

/** Returns every account_id the token has access to. */
export async function listAccountIds(): Promise<number[]> {
  if (cached && Date.now() - cachedAt < TTL_MS) return cached;
  const client = new PublicApiClient();
  // /1/account returns [{id, name}] — verified live (same endpoint as overview tool).
  try {
    const accounts = await client.request<Array<{ id: number; name?: string }>>(
      "GET",
      "/1/account",
    );
    cached = accounts.map((a) => a.id).filter((id): id is number => typeof id === "number");
  } catch {
    cached = [];
  }
  cachedAt = Date.now();
  return cached;
}

/**
 * Resolve an account_id when the caller did not provide one.
 * Defaults to the first account_id from the profile list.
 *
 * Returns `null` if the token has access to no accounts (which itself
 * is a signal the caller should surface to the user).
 */
export async function defaultAccountId(): Promise<number | null> {
  const ids = await listAccountIds();
  return ids.length > 0 ? ids[0] : null;
}
