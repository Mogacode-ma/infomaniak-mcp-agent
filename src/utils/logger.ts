/**
 * Structured logger — writes to stderr only.
 *
 * IMPORTANT: MCP stdio servers MUST NOT write to stdout (it's the JSON-RPC channel).
 * All logs go to stderr.
 */
import pino from "pino";

import { loadConfig } from "../config.js";

const config = loadConfig();

/**
 * Mask sensitive values in log payloads.
 * Use this when logging objects that may contain tokens or cookies.
 */
const REDACT_PATHS = [
  "token",
  "access_token",
  "refresh_token",
  "Authorization",
  "authorization",
  "Cookie",
  "cookie",
  "SASESSION",
  "X-XSRF-TOKEN",
  "MANAGER-XSRF-TOKEN",
  "password",
  "secret",
  "client_secret",
  "*.token",
  "*.access_token",
  "*.refresh_token",
  "*.password",
];

export const logger = pino(
  {
    level: config.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.destination(2), // stderr
);

/**
 * Creates a child logger with additional bound context (e.g. request_id).
 */
export function childLogger(bindings: Record<string, unknown>): pino.Logger {
  return logger.child(bindings);
}
