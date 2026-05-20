/**
 * Runtime configuration — validated with Zod at startup.
 * Fails fast if env vars are malformed.
 */
import { z } from "zod";

const ConfigSchema = z.object({
  /** Bearer token for api.infomaniak.com (REQUIRED). */
  INFOMANIAK_API_TOKEN: z.string().min(20, "INFOMANIAK_API_TOKEN looks too short"),

  /** Authentication mode for manager.infomaniak.com/proxy/* (manager private API). */
  INFOMANIAK_AUTH_MODE: z.enum(["auto", "manual", "disabled"]).default("auto"),

  /** Manual SASESSION cookie value (used when INFOMANIAK_AUTH_MODE=manual). */
  INFOMANIAK_SASESSION: z.string().optional(),

  /** Manual MANAGER-XSRF-TOKEN cookie value (used when INFOMANIAK_AUTH_MODE=manual). */
  INFOMANIAK_XSRF_TOKEN: z.string().optional(),

  /** pino log level. */
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),

  /** Confirmation token TTL for destructive operations (seconds). */
  CONFIRMATION_TTL_SECONDS: z.coerce.number().int().min(10).max(600).default(60),

  /** Rate limit per minute (Infomaniak hard cap is 60, do not raise). */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(60).default(60),
});

export type Config = z.infer<typeof ConfigSchema>;

let cached: Config | null = null;

/**
 * Loads and validates the runtime configuration.
 *
 * - Throws a descriptive error if a required variable is missing or malformed.
 * - Caches the result so subsequent calls return the same object.
 */
export function loadConfig(): Config {
  if (cached !== null) {
    return cached;
  }
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      [
        "Invalid runtime configuration — required environment variable(s) missing or malformed:",
        issues,
        "",
        "How to set them:",
        "  • Claude Desktop / Claude Code: add them to the `env` block of your MCP server entry in",
        "    `claude_desktop_config.json` (or `~/.claude.json` for Claude Code).",
        "    See: https://github.com/Mogacode-ma/infomaniak-mcp-agent#configure-claude-desktop",
        "  • From a shell: export INFOMANIAK_API_TOKEN=... before running the server.",
        "  • Running from a clone: copy .env.example to .env and fill it in.",
        "",
        "Get an API token at: https://manager.infomaniak.com/v3/api-token",
      ].join("\n"),
    );
  }
  cached = parsed.data;
  return cached;
}

/**
 * Resets the cached config — only used by tests.
 *
 * @internal
 */
export function _resetConfigCache(): void {
  cached = null;
}
