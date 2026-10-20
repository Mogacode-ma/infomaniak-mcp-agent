import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { InfomaniakAuthError } from "../../src/api/errors.js";
import { loadManagerSession } from "../../src/auth/cookie.js";
import { _resetConfigCache } from "../../src/config.js";
import { getVpsFirewallTool, getVpsFullTool, listVpsTool } from "../../src/tools/vps.js";

vi.mock("../../src/auth/cookie.js", () => ({ loadManagerSession: vi.fn() }));
vi.mock("../../src/throttle/token-bucket.js", () => ({
  createDefaultThrottle: () => ({ acquire: async () => undefined }),
}));

const server = setupServer();
const inventory = {
  id: 1,
  account_id: 10,
  service_id: 25,
  service_name: "cloud",
  customer_name: "Test VPS",
  created_at: 1,
  lite: true,
};
const rule = {
  id: 2,
  vps_id: 1,
  enabled: true,
  ip_type: "ipv4",
  port_type: "tcp",
  port_selection: "specific",
  port_selection_type: "list",
  port_selection_list: [22],
  specific_ip: null,
  applications: [],
};

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  vi.stubEnv("INFOMANIAK_AUTH_MODE", "disabled");
  _resetConfigCache();
  vi.mocked(loadManagerSession).mockReset();
});
afterEach(() => {
  server.resetHandlers();
  vi.unstubAllEnvs();
  _resetConfigCache();
});
afterAll(() => server.close());

describe("VPS reads", () => {
  it("rejects invalid identifiers at the input boundary", () => {
    expect(listVpsTool.inputSchema.safeParse({ account_id: 0 }).success).toBe(false);
    expect(getVpsFirewallTool.inputSchema.safeParse({ account_id: 10, vps_id: -1 }).success).toBe(
      false,
    );
  });

  it("lists VPS with a Bearer token and no Manager session", async () => {
    server.use(
      http.get("https://api.infomaniak.com/2/vps", ({ request }) => {
        expect(new URL(request.url).searchParams.get("account_id")).toBe("10");
        expect(request.headers.get("authorization")).toMatch(/^Bearer /);
        return HttpResponse.json({ result: "success", data: [inventory] });
      }),
    );
    expect(await listVpsTool.handler({ account_id: 10 })).toMatchObject({
      count: 1,
      vps: [inventory],
    });
    expect(loadManagerSession).not.toHaveBeenCalled();
  });

  it("keeps the Manager route when its session is available", async () => {
    vi.stubEnv("INFOMANIAK_AUTH_MODE", "auto");
    _resetConfigCache();
    vi.mocked(loadManagerSession).mockResolvedValue({
      sasession: "fixture",
      xsrfToken: "fixture",
      source: "manual",
      acquiredAt: new Date(0),
    });
    server.use(
      http.get("https://manager.infomaniak.com/proxy/1/vps", () =>
        HttpResponse.json({ result: "success", data: [inventory] }),
      ),
    );
    expect(await listVpsTool.handler({ account_id: 10 })).toMatchObject({ count: 1 });
  });

  it("falls back only when Manager authentication is unavailable", async () => {
    vi.stubEnv("INFOMANIAK_AUTH_MODE", "auto");
    _resetConfigCache();
    vi.mocked(loadManagerSession).mockRejectedValue(
      new InfomaniakAuthError({ message: "No session" }),
    );
    server.use(
      http.get("https://api.infomaniak.com/2/vps", () =>
        HttpResponse.json({ result: "success", data: [] }),
      ),
    );
    expect(await listVpsTool.handler({ account_id: 10 })).toEqual({
      account_id: 10,
      count: 0,
      vps: [],
    });
  });

  it("preserves other Manager failures", async () => {
    vi.stubEnv("INFOMANIAK_AUTH_MODE", "auto");
    _resetConfigCache();
    vi.mocked(loadManagerSession).mockRejectedValue(new Error("Session extraction failed"));
    await expect(listVpsTool.handler({ account_id: 10 })).rejects.toThrow(
      "Session extraction failed",
    );
  });

  it("validates public inventory instead of returning malformed data", async () => {
    server.use(
      http.get("https://api.infomaniak.com/2/vps", () =>
        HttpResponse.json({ result: "success", data: [{ id: "wrong" }] }),
      ),
    );
    await expect(listVpsTool.handler({ account_id: 10 })).rejects.toThrow();
  });

  it("reads and validates firewall rules, preserving provider-specific fields", async () => {
    server.use(
      http.get("https://api.infomaniak.com/2/vps/1/firewall", ({ request }) => {
        expect(new URL(request.url).searchParams.get("account_id")).toBe("10");
        return HttpResponse.json({ result: "success", data: [rule] });
      }),
    );
    const result = await getVpsFirewallTool.handler({ account_id: 10, vps_id: 1 });
    expect(result).toEqual({ account_id: 10, vps_id: 1, count: 1, rules: [rule] });
    expect(getVpsFirewallTool.outputSchema?.safeParse(result).success).toBe(true);
    expect(loadManagerSession).not.toHaveBeenCalled();
  });

  it("returns an empty firewall without inventing rules", async () => {
    server.use(
      http.get("https://api.infomaniak.com/2/vps/1/firewall", () =>
        HttpResponse.json({ result: "success", data: [] }),
      ),
    );
    expect(await getVpsFirewallTool.handler({ account_id: 10, vps_id: 1 })).toMatchObject({
      count: 0,
      rules: [],
    });
  });

  it.each(["range", null])("accepts a null port list with selection type %s", async (selection) => {
    const rangeRule = {
      ...rule,
      port_selection_list: null,
      port_selection_type: selection,
      port_selection_range_start: 80,
      port_selection_range_stop: 90,
    };
    server.use(
      http.get("https://api.infomaniak.com/2/vps/1/firewall", () =>
        HttpResponse.json({ result: "success", data: [rangeRule] }),
      ),
    );
    expect(await getVpsFirewallTool.handler({ account_id: 10, vps_id: 1 })).toMatchObject({
      rules: [rangeRule],
    });
  });

  it("rejects malformed firewall rules", async () => {
    server.use(
      http.get("https://api.infomaniak.com/2/vps/1/firewall", () =>
        HttpResponse.json({ result: "success", data: [{ ...rule, enabled: "yes" }] }),
      ),
    );
    await expect(getVpsFirewallTool.handler({ account_id: 10, vps_id: 1 })).rejects.toThrow();
  });

  it.each(["list", "firewall"])("propagates public authorization errors: %s", async (kind) => {
    server.use(
      http.get("https://api.infomaniak.com/2/vps*", () =>
        HttpResponse.json({ result: "error", error: { code: "forbidden" } }, { status: 403 }),
      ),
    );
    const request =
      kind === "list"
        ? listVpsTool.handler({ account_id: 10 })
        : getVpsFirewallTool.handler({ account_id: 10, vps_id: 1 });
    await expect(request).rejects.toBeInstanceOf(InfomaniakAuthError);
  });

  it("full detail still requires Manager authentication", async () => {
    vi.mocked(loadManagerSession).mockRejectedValue(
      new InfomaniakAuthError({ message: "Disabled" }),
    );
    await expect(getVpsFullTool.handler({ vps_id: 1 })).rejects.toThrow("Disabled");
  });
});
