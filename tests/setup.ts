/**
 * Vitest setup — runs before any test file is imported.
 *
 * Sets a placeholder API token so modules that call `loadConfig()` at
 * import time (config-dependent loggers, http clients, …) can be imported
 * by tests without failing. Individual tests are free to override the
 * environment as needed.
 */
process.env["INFOMANIAK_API_TOKEN"] ??= "test-token-placeholder-".padEnd(40, "x");
process.env["LOG_LEVEL"] ??= "silent";
