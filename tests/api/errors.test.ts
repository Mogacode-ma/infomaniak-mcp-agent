import { describe, expect, it } from "vitest";

import {
  InfomaniakAuthError,
  InfomaniakCsrfError,
  InfomaniakNotFoundError,
  InfomaniakRateLimitError,
  InfomaniakServerError,
  InfomaniakValidationError,
  mapHttpError,
} from "../../src/api/errors.js";

describe("mapHttpError", () => {
  const ctx = { method: "GET", path: "/x" };

  it("maps 401 not_authorized to InfomaniakAuthError", () => {
    const err = mapHttpError(401, { result: "error", error: { code: "not_authorized" } }, ctx);
    expect(err).toBeInstanceOf(InfomaniakAuthError);
    expect(err.actionable).toMatch(/token|cookie|chrome/i);
  });

  it("maps 403 forbidden to InfomaniakAuthError with elevated-session hint", () => {
    const err = mapHttpError(
      403,
      { result: "error", error: { code: "forbidden", description: "secured route" } },
      ctx,
    );
    expect(err).toBeInstanceOf(InfomaniakAuthError);
    expect(err.actionable).toMatch(/elevated|session|re-login/i);
  });

  it("maps 419 token_mismatch to InfomaniakCsrfError", () => {
    const err = mapHttpError(419, { result: "error", error: { code: "token_mismatch" } }, ctx);
    expect(err).toBeInstanceOf(InfomaniakCsrfError);
    expect(err.actionable).toMatch(/X-XSRF-TOKEN|cookie|refresh/i);
  });

  it("maps 422 validation_failed and surfaces missing required fields", () => {
    const err = mapHttpError(
      422,
      {
        result: "error",
        error: {
          code: "validation_failed",
          errors: [
            {
              code: "validation_rule_required",
              context: { attribute: "fqdn" },
            },
            {
              code: "validation_rule_required",
              context: { attribute: "directory" },
            },
          ],
        },
      },
      ctx,
    );
    expect(err).toBeInstanceOf(InfomaniakValidationError);
    expect((err as InfomaniakValidationError).missingFields).toEqual(["fqdn", "directory"]);
    expect(err.actionable).toMatch(/fqdn/);
  });

  it("maps 429 to InfomaniakRateLimitError", () => {
    const err = mapHttpError(429, { result: "error", error: { code: "rate_limit" } }, ctx);
    expect(err).toBeInstanceOf(InfomaniakRateLimitError);
    expect((err as InfomaniakRateLimitError).retryAfterMs).toBeGreaterThan(0);
  });

  it("maps 404 method_not_found to InfomaniakNotFoundError", () => {
    const err = mapHttpError(404, { result: "error", error: { code: "method_not_found" } }, ctx);
    expect(err).toBeInstanceOf(InfomaniakNotFoundError);
  });

  it("falls back to InfomaniakServerError for unknown failures", () => {
    const err = mapHttpError(500, { result: "error", error: { code: "boom" } }, ctx);
    expect(err).toBeInstanceOf(InfomaniakServerError);
  });

  it("renders a tool error payload with the actionable hint", () => {
    const err = mapHttpError(401, { result: "error", error: { code: "not_authorized" } }, ctx);
    const payload = err.toToolError();
    expect(payload.isError).toBe(true);
    expect(payload.content[0]?.text).toContain("→");
  });
});
