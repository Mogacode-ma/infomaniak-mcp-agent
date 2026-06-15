/**
 * HTTP client primitives.
 *
 * Two specialized clients are exported:
 *
 * - {@link PublicApiClient} — Bearer token auth against api.infomaniak.com.
 *   Read-only-ish: covers profile, products, mail, drive, dns, etc.
 *
 * - {@link ManagerApiClient} — SASESSION + CSRF auth against
 *   manager.infomaniak.com/proxy/. Required for write operations on
 *   web hosting (sites, databases, applications) — see
 *   REVERSE-ENGINEERING.md for why.
 *
 * Both clients share the same throttle (60 req/min Infomaniak hard limit)
 * and the same typed-error mapping.
 */
import { randomUUID } from "node:crypto";

import { type ManagerSession, loadManagerSession } from "../auth/cookie.js";
import { loadConfig } from "../config.js";
import { type TokenBucket, createDefaultThrottle } from "../throttle/token-bucket.js";
import { childLogger } from "../utils/logger.js";

import { mapHttpError, InfomaniakError } from "./errors.js";

const log = childLogger({ module: "api/http" });

/** HTTP methods we use. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestOptions {
  /** Query string parameters (URL-encoded automatically). */
  query?: Record<string, string | number | boolean | undefined>;
  /** JSON-serialized body for non-GET requests. */
  body?: unknown;
  /** Extra headers to merge with auth headers. */
  headers?: Record<string, string>;
  /** Maximum time before aborting (ms). Default: 30_000. */
  timeoutMs?: number;
}

interface SuccessEnvelope<T> {
  result: "success";
  data: T;
}

const PUBLIC_BASE_URL = "https://api.infomaniak.com";
const MANAGER_BASE_URL = "https://manager.infomaniak.com";

/** Shared throttle so public + manager clients share the same 60 req/min budget. */
const sharedThrottle = createDefaultThrottle(loadConfig().RATE_LIMIT_PER_MINUTE);

/** Public Infomaniak API (api.infomaniak.com) — Bearer token auth. */
export class PublicApiClient {
  private readonly token: string;
  private readonly throttle: TokenBucket;

  constructor(
    token: string = loadConfig().INFOMANIAK_API_TOKEN,
    throttle: TokenBucket = sharedThrottle,
  ) {
    this.token = token;
    this.throttle = throttle;
  }

  public async request<T>(
    method: HttpMethod,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = buildUrl(PUBLIC_BASE_URL, path, options.query);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
      ...(options.headers ?? {}),
    };
    return executeRequest<T>(this.throttle, method, url, headers, options);
  }
}

/** Manager-private API (manager.infomaniak.com/proxy/...) — SASESSION + CSRF. */
export class ManagerApiClient {
  private readonly throttle: TokenBucket;
  private session: ManagerSession | null;

  constructor(throttle: TokenBucket = sharedThrottle) {
    this.throttle = throttle;
    this.session = null;
  }

  /** Lazily loads the session on first use. */
  private async ensureSession(): Promise<ManagerSession> {
    if (this.session === null) {
      this.session = await loadManagerSession();
    }
    return this.session;
  }

  /** Forces a fresh session re-read (e.g. after a 401/419). */
  public async refreshSession(): Promise<void> {
    this.session = await loadManagerSession();
  }

  public async request<T>(
    method: HttpMethod,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const session = await this.ensureSession();
    const url = buildUrl(MANAGER_BASE_URL, path, options.query);
    const headers: Record<string, string> = {
      Cookie: `SASESSION=${session.sasession}`,
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
      Referer: "https://manager.infomaniak.com/",
      ...(options.headers ?? {}),
    };
    if (method !== "GET") {
      headers["X-XSRF-TOKEN"] = session.xsrfToken;
    }
    try {
      return await executeRequest<T>(this.throttle, method, url, headers, options);
    } catch (err) {
      // The browser session can rotate its CSRF token (e.g. the user just
      // re-logged into manager.infomaniak.com). Our cached session then holds
      // a stale MANAGER-XSRF-TOKEN → the manager answers:
      //   - 419 / 401 (CSRF/auth expired) on most endpoints
      //   - 500 "unexpected_error" (catch-all) on some PATCH endpoints
      //     under /proxy/1/web_hostings/.../database_users and /users
      //     (discovered live 2026-06-15: stale XSRF on these particular
      //     mutating endpoints triggers a server-side fatal instead of
      //     a clean 419). Either way: re-read cookies and retry once.
      const status = err instanceof InfomaniakError ? err.status : undefined;
      const code = err instanceof InfomaniakError ? err.code : undefined;
      const isCsrfStale =
        status === 419 || status === 401 || (status === 500 && code === "unexpected_error");
      if (isCsrfStale) {
        await this.refreshSession();
        const fresh = this.session as ManagerSession;
        const retryHeaders: Record<string, string> = {
          Cookie: `SASESSION=${fresh.sasession}`,
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
          Referer: "https://manager.infomaniak.com/",
          ...(options.headers ?? {}),
        };
        if (method !== "GET") {
          retryHeaders["X-XSRF-TOKEN"] = fresh.xsrfToken;
        }
        return executeRequest<T>(this.throttle, method, url, retryHeaders, options);
      }
      throw err;
    }
  }
}

async function executeRequest<T>(
  throttle: TokenBucket,
  method: HttpMethod,
  url: string,
  headers: Record<string, string>,
  options: RequestOptions,
): Promise<T> {
  await throttle.acquire();
  const requestId = randomUUID();
  const correlatedLog = log.child({ requestId, method, url });
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const init: RequestInit = {
    method,
    headers,
    signal: controller.signal,
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
  }

  try {
    const response = await fetch(url, init);
    const text = await response.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!response.ok) {
      throw mapHttpError(response.status, parsed, { method, path: url });
    }
    correlatedLog.debug({ status: response.status }, "API call success");
    return unwrapEnvelope<T>(parsed);
  } catch (err) {
    if (err instanceof InfomaniakError) {
      throw err;
    }
    if (err instanceof Error && err.name === "AbortError") {
      throw new InfomaniakError({
        message: `Request timed out after ${timeoutMs}ms`,
        actionable: "Increase timeoutMs in the call options or check Infomaniak status.",
        cause: err,
      });
    }
    throw new InfomaniakError({
      message: "Network or unknown error",
      actionable: "Check your internet connection. Logs contain the underlying error.",
      cause: err,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function buildUrl(
  base: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): string {
  const url = new URL(path, base);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

function unwrapEnvelope<T>(parsed: unknown): T {
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "result" in parsed &&
    (parsed as { result?: unknown }).result === "success" &&
    "data" in parsed
  ) {
    return (parsed as SuccessEnvelope<T>).data;
  }
  // Some endpoints (e.g. manager /v3/api/...) return raw JSON without envelope.
  return parsed as T;
}
