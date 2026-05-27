import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetConfigCache } from "../../src/config.js";
import { auditAccountTool } from "../../src/tools/audit.js";

describe("infomaniak_audit_account", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env["INFOMANIAK_API_TOKEN"] = "x".repeat(40);
    _resetConfigCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("classifies products by severity (critical / warning / info)", async () => {
    const now = 1_777_500_000;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now * 1000));

    const expiredProduct = {
      id: 1,
      account_id: 99,
      service_id: 14,
      service_name: "domain",
      customer_name: "expired.example",
      expired_at: now - 86_400, // expired 1 day ago
    };
    const expiringSoon = {
      id: 2,
      account_id: 99,
      service_id: 14,
      service_name: "domain",
      customer_name: "expiring-soon.example",
      expired_at: now + 7 * 86_400, // 7 days
    };
    const lockedProduct = {
      id: 3,
      account_id: 99,
      service_id: 1,
      service_name: "hosting",
      customer_name: "locked.example",
      is_locked: true,
    };
    const healthyProduct = {
      id: 4,
      account_id: 99,
      service_id: 1,
      service_name: "hosting",
      customer_name: "healthy.example",
      expired_at: now + 365 * 86_400,
    };

    // The audit tool fetches per-domain live truth via /1/domain/{name} for
    // domain products (because /1/products.expired_at is stale in prod).
    // Mock both endpoints accordingly.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/1/products")) {
        return new Response(
          JSON.stringify({
            result: "success",
            data: [expiredProduct, expiringSoon, lockedProduct, healthyProduct],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/1/domain/expired.example")) {
        return new Response(
          JSON.stringify({ result: "success", data: { expired_at: now - 86_400 } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/1/domain/expiring-soon.example")) {
        return new Response(
          JSON.stringify({ result: "success", data: { expired_at: now + 7 * 86_400 } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ result: "error" }), { status: 404 });
    }) as typeof fetch;

    const result = (await auditAccountTool.handler({
      account_id: 99,
      days_ahead: 60,
    })) as {
      scanned_products: number;
      findings: Array<{ severity: string; category: string; product_id?: number }>;
    };

    expect(result.scanned_products).toBe(4);

    const critical = result.findings.filter((f) => f.severity === "critical");
    const warnings = result.findings.filter((f) => f.severity === "warning");
    expect(critical).toHaveLength(1);
    expect(critical[0]?.product_id).toBe(1);
    expect(warnings.some((w) => w.product_id === 2 && w.category === "expiration")).toBe(true);
    expect(warnings.some((w) => w.product_id === 3 && w.category === "locked")).toBe(true);

    // Healthy product should never appear in the findings.
    expect(result.findings.some((f) => f.product_id === 4)).toBe(false);
  });
});
