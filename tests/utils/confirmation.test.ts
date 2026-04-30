import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetConfigCache } from "../../src/config.js";
import { _resetTokens, consumeToken, mintToken } from "../../src/utils/confirmation.js";

describe("confirmation tokens", () => {
  beforeEach(() => {
    process.env["INFOMANIAK_API_TOKEN"] = "x".repeat(40);
    process.env["CONFIRMATION_TTL_SECONDS"] = "60";
    _resetConfigCache();
    _resetTokens();
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetTokens();
  });

  it("mints unique tokens for the same fingerprint", () => {
    const a = mintToken("op:a");
    const b = mintToken("op:a");
    expect(a.token).not.toBe(b.token);
  });

  it("consumes a token successfully when the fingerprint matches", () => {
    const { token } = mintToken("op:create");
    expect(consumeToken(token, "op:create")).toBe(true);
  });

  it("refuses to consume a token whose fingerprint changed", () => {
    const { token } = mintToken("op:create:fqdn=A");
    expect(consumeToken(token, "op:create:fqdn=B")).toBe(false);
    // Token was preserved and remains valid for the legitimate caller.
    expect(consumeToken(token, "op:create:fqdn=A")).toBe(true);
  });

  it("is single-use: a successful consume invalidates the token", () => {
    const { token } = mintToken("op:apply");
    expect(consumeToken(token, "op:apply")).toBe(true);
    expect(consumeToken(token, "op:apply")).toBe(false);
  });

  it("expires after the configured TTL", () => {
    vi.useFakeTimers();
    process.env["CONFIRMATION_TTL_SECONDS"] = "30";
    _resetConfigCache();

    const { token, expiresAt } = mintToken("op:expiring");
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    vi.advanceTimersByTime(31_000);
    expect(consumeToken(token, "op:expiring")).toBe(false);
  });

  it("rejects unknown tokens", () => {
    expect(consumeToken("never-minted", "op:foo")).toBe(false);
  });
});
