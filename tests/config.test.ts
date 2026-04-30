import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { _resetConfigCache, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    _resetConfigCache();
    // Wipe env so each test starts from a clean slate.
    for (const key of Object.keys(process.env)) {
      if (
        key.startsWith("INFOMANIAK_") ||
        key === "LOG_LEVEL" ||
        key === "CONFIRMATION_TTL_SECONDS" ||
        key === "RATE_LIMIT_PER_MINUTE"
      ) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    Object.assign(process.env, originalEnv);
    _resetConfigCache();
  });

  it("throws a descriptive error when the API token is missing", () => {
    expect(() => loadConfig()).toThrow(/INFOMANIAK_API_TOKEN/);
  });

  it("returns a valid config with sensible defaults when only the token is set", () => {
    process.env["INFOMANIAK_API_TOKEN"] = "x".repeat(40);
    const cfg = loadConfig();
    expect(cfg.INFOMANIAK_API_TOKEN.length).toBeGreaterThanOrEqual(20);
    expect(cfg.INFOMANIAK_AUTH_MODE).toBe("auto");
    expect(cfg.LOG_LEVEL).toBe("info");
    expect(cfg.CONFIRMATION_TTL_SECONDS).toBe(60);
    expect(cfg.RATE_LIMIT_PER_MINUTE).toBe(60);
  });

  it("rejects invalid auth modes", () => {
    process.env["INFOMANIAK_API_TOKEN"] = "x".repeat(40);
    process.env["INFOMANIAK_AUTH_MODE"] = "telepathy";
    expect(() => loadConfig()).toThrow(/INFOMANIAK_AUTH_MODE/);
  });

  it("clamps RATE_LIMIT_PER_MINUTE to the documented Infomaniak cap", () => {
    process.env["INFOMANIAK_API_TOKEN"] = "x".repeat(40);
    process.env["RATE_LIMIT_PER_MINUTE"] = "9999";
    expect(() => loadConfig()).toThrow(/RATE_LIMIT_PER_MINUTE/);
  });

  it("caches the validated config", () => {
    process.env["INFOMANIAK_API_TOKEN"] = "x".repeat(40);
    const a = loadConfig();
    const b = loadConfig();
    expect(a).toBe(b);
  });
});
