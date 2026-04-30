/**
 * Manager-private auth: extract SASESSION + MANAGER-XSRF-TOKEN
 * either from the user's local Chrome cookie store (auto mode) or from
 * env-provided values (manual mode).
 *
 * The cookies are NEVER persisted to disk by this package.
 */
import { InfomaniakAuthError } from "../api/errors.js";
import { loadConfig } from "../config.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger({ module: "auth/cookie" });

export interface ManagerSession {
  /** SASESSION cookie value — bound to the user's manager.infomaniak.com session. */
  sasession: string;
  /**
   * URL-DECODED value of the MANAGER-XSRF-TOKEN cookie.
   * Must be sent in the X-XSRF-TOKEN header for POST/PUT/PATCH/DELETE.
   */
  xsrfToken: string;
  /** Where the session came from — useful for diagnostics and refresh logic. */
  source: "auto" | "manual";
  /** Best-effort timestamp of when the session was retrieved. */
  acquiredAt: Date;
}

/**
 * Loads a manager session, using the configured INFOMANIAK_AUTH_MODE.
 *
 * - `auto`: read cookies from the user's local Chrome store
 * - `manual`: use INFOMANIAK_SASESSION + INFOMANIAK_XSRF_TOKEN env vars
 * - `disabled`: throw — manager-private operations are not allowed
 */
export async function loadManagerSession(): Promise<ManagerSession> {
  const config = loadConfig();

  if (config.INFOMANIAK_AUTH_MODE === "disabled") {
    throw new InfomaniakAuthError({
      message: "Manager-private operations are disabled",
      actionable: "Set INFOMANIAK_AUTH_MODE=auto (or manual) in your .env to enable them.",
    });
  }

  if (config.INFOMANIAK_AUTH_MODE === "manual") {
    if (!config.INFOMANIAK_SASESSION || !config.INFOMANIAK_XSRF_TOKEN) {
      throw new InfomaniakAuthError({
        message: "Manual auth selected but credentials are missing",
        actionable:
          "Set both INFOMANIAK_SASESSION and INFOMANIAK_XSRF_TOKEN in your .env, " +
          "or switch to INFOMANIAK_AUTH_MODE=auto for automatic Chrome extraction.",
      });
    }
    return {
      sasession: config.INFOMANIAK_SASESSION,
      xsrfToken: decodeURIComponent(config.INFOMANIAK_XSRF_TOKEN),
      source: "manual",
      acquiredAt: new Date(),
    };
  }

  // Auto mode: extract from Chrome.
  return extractFromChrome();
}

/**
 * Extracts the SASESSION and MANAGER-XSRF-TOKEN cookies from the local
 * Chrome cookie store on macOS / Windows / Linux.
 *
 * Uses the `chrome-cookies-secure` package which knows how to decrypt
 * Chrome's per-platform cookie storage.
 *
 * Throws InfomaniakAuthError with an actionable message if the cookies
 * are missing or expired (typically because the user is not logged into
 * https://manager.infomaniak.com in Chrome).
 */
async function extractFromChrome(): Promise<ManagerSession> {
  // Lazy-import to keep cold-start fast for users in manual mode.
  const { default: chrome } = await import("chrome-cookies-secure");

  const cookieJar = await new Promise<Record<string, string>>((resolve, reject) => {
    chrome.getCookies(
      "https://manager.infomaniak.com/",
      "object",
      (err: Error | null, cookies: Record<string, string>) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(cookies);
      },
    );
  }).catch((err: unknown) => {
    log.error({ err }, "Failed to read Chrome cookies");
    throw new InfomaniakAuthError({
      message: "Could not read Chrome cookies",
      actionable:
        "Make sure Chrome is installed and you have at least once opened https://manager.infomaniak.com. " +
        "On macOS, you may need to grant Keychain access. " +
        "Alternatively, switch to INFOMANIAK_AUTH_MODE=manual and paste cookies in your .env.",
      cause: err,
    });
  });

  const sasession = cookieJar["SASESSION"];
  const xsrfRaw = cookieJar["MANAGER-XSRF-TOKEN"];

  if (!sasession || !xsrfRaw) {
    throw new InfomaniakAuthError({
      message: "Required Infomaniak cookies not found in Chrome",
      actionable:
        "Open https://manager.infomaniak.com in Chrome and log in. Then retry. " +
        "If the problem persists, switch to INFOMANIAK_AUTH_MODE=manual.",
    });
  }

  log.debug({ source: "chrome", hasSasession: true, hasXsrf: true }, "Manager session loaded");

  return {
    sasession,
    xsrfToken: decodeURIComponent(xsrfRaw),
    source: "auto",
    acquiredAt: new Date(),
  };
}
