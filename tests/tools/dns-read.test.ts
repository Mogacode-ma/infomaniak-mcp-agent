import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { dnsCheckPropagationTool, dnsDiffTool, dnsExportTool } from "../../src/tools/dns-read.js";

const { query, resolverOptions } = vi.hoisted(() => ({
  query: vi.fn<(ip: string | undefined, domain: string, type: string) => Promise<unknown[]>>(),
  resolverOptions: vi.fn(),
}));
vi.mock("node:dns/promises", () => ({
  Resolver: class {
    private servers: string[] = [];
    constructor(options: unknown) {
      resolverOptions(options);
    }
    setServers(servers: string[]): void {
      this.servers = servers;
    }
    async resolve(domain: string, type: string): Promise<unknown[]> {
      return query(this.servers[0], domain, type);
    }
  },
}));
vi.mock("../../src/throttle/token-bucket.js", () => ({
  createDefaultThrottle: () => ({ acquire: async () => undefined }),
}));

const server = setupServer();
const path = "https://api.infomaniak.com/2/zones/example.com/records";
const record = { id: 1, source: ".", type: "A", target: "192.0.2.1", ttl: 300 };

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  query.mockReset();
});
afterEach(() => {
  server.resetHandlers();
  resolverOptions.mockClear();
});
afterAll(() => server.close());

describe("DNS export and diff", () => {
  it.each([dnsExportTool, dnsDiffTool])("rejects invalid input: $name", (tool) => {
    expect(tool.inputSchema.safeParse({ zone: "" }).success).toBe(false);
  });

  it("exports validated JSON with record IDs and TTLs", async () => {
    server.use(http.get(path, () => HttpResponse.json({ result: "success", data: [record] })));
    const result = (await dnsExportTool.handler(
      dnsExportTool.inputSchema.parse({ zone: "example.com" }),
    )) as { content: string };
    expect(JSON.parse(result.content)).toEqual([record]);
    expect(dnsExportTool.outputSchema?.safeParse(result).success).toBe(true);
  });

  it("quotes CSV commas, quotes and newlines without changing TXT content", async () => {
    const txt = { ...record, type: "TXT", target: '"quoted, value"\nsecond line' };
    server.use(http.get(path, () => HttpResponse.json({ result: "success", data: [txt] })));
    const result = (await dnsExportTool.handler({ zone: "example.com", format: "csv" })) as {
      content: string;
    };
    expect(result.content).toBe(
      'id,source,type,target,ttl\r\n"1",".","TXT","""quoted, value""\nsecond line","300"',
    );
  });

  it("exports an empty zone", async () => {
    server.use(http.get(path, () => HttpResponse.json({ result: "success", data: [] })));
    expect(await dnsExportTool.handler({ zone: "example.com", format: "csv" })).toMatchObject({
      count: 0,
      content: "id,source,type,target,ttl",
    });
  });

  it("reports additions, removals and TTL changes separately", async () => {
    const removed = { ...record, id: 2, source: "old" };
    const changed = { ...record, ttl: 600 };
    const added = { ...record, source: "new" };
    server.use(
      http.get(path, () => HttpResponse.json({ result: "success", data: [record, removed] })),
    );
    const result = await dnsDiffTool.handler({ zone: "example.com", records: [changed, added] });
    expect(result).toEqual({
      zone: "example.com",
      added: [added],
      removed: [removed],
      ttl_changes: [{ before: record, after: changed }],
      unchanged: 0,
    });
    expect(dnsDiffTool.outputSchema?.safeParse(result).success).toBe(true);
  });

  it("ignores IDs, timestamps and ordering through parsed input, and recognizes apex spelling", async () => {
    server.use(http.get(path, () => HttpResponse.json({ result: "success", data: [record] })));
    const input = dnsDiffTool.inputSchema.parse({
      zone: "example.com",
      records: [{ ...record, id: 999, source: "@", updated_at: 123 }],
    });
    expect(await dnsDiffTool.handler(input)).toMatchObject({
      added: [],
      removed: [],
      ttl_changes: [],
      unchanged: 1,
    });
  });

  it("consumes exact duplicate TTL matches before pairing TTL changes", async () => {
    const other = { ...record, id: 2, ttl: 600 };
    server.use(
      http.get(path, () => HttpResponse.json({ result: "success", data: [record, other] })),
    );
    expect(
      await dnsDiffTool.handler({
        zone: "example.com",
        records: [{ ...record, ttl: 900 }, record],
      }),
    ).toMatchObject({
      added: [],
      removed: [],
      unchanged: 1,
      ttl_changes: [{ before: other, after: { ...record, ttl: 900 } }],
    });
  });

  it("retains duplicate counts and literal TXT values", async () => {
    const txt = { ...record, type: "TXT", target: '"Value"' };
    server.use(http.get(path, () => HttpResponse.json({ result: "success", data: [txt, txt] })));
    expect(
      await dnsDiffTool.handler({ zone: "example.com", records: [{ ...txt, target: '"value"' }] }),
    ).toMatchObject({
      added: [{ ...txt, target: '"value"' }],
      removed: [txt, txt],
      unchanged: 0,
    });
  });

  it.each([dnsExportTool, dnsDiffTool])("propagates API errors: $name", async (tool) => {
    server.use(
      http.get(path, () =>
        HttpResponse.json({ result: "error", error: { code: "forbidden" } }, { status: 403 }),
      ),
    );
    await expect(
      tool.handler({ zone: "example.com", format: "json", records: [] }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it.each([dnsExportTool, dnsDiffTool])(
    "rejects malformed provider records: $name",
    async (tool) => {
      server.use(
        http.get(path, () =>
          HttpResponse.json({ result: "success", data: [{ ...record, ttl: "wrong" }] }),
        ),
      );
      await expect(
        tool.handler({ zone: "example.com", format: "json", records: [] }),
      ).rejects.toThrow();
    },
  );
});

describe("DNS propagation", () => {
  function input(type = "A"): unknown {
    return dnsCheckPropagationTool.inputSchema.parse({ domain: "example.com", type });
  }

  it("rejects URLs, unsupported types and duplicate resolvers", () => {
    for (const value of [
      { domain: "https://example.com" },
      { domain: "example.com", type: "ANY" },
      { domain: "example.com", resolvers: ["google", "google"] },
    ]) {
      expect(dnsCheckPropagationTool.inputSchema.safeParse(value).success).toBe(false);
    }
  });

  it("queries the selected servers directly and ignores answer ordering", async () => {
    query.mockImplementation(async (ip) =>
      ip === "8.8.8.8" ? ["192.0.2.1", "192.0.2.2"] : ["192.0.2.2", "192.0.2.1"],
    );
    const result = await dnsCheckPropagationTool.handler(input());
    expect(result).toMatchObject({ agree: true });
    expect(query.mock.calls.map(([ip]) => ip).sort()).toEqual(["1.1.1.1", "8.8.8.8", "9.9.9.9"]);
    expect(resolverOptions).toHaveBeenCalledWith({ timeout: 3000, tries: 2 });
    expect(dnsCheckPropagationTool.outputSchema?.safeParse(result).success).toBe(true);
  });

  it("reports disagreement", async () => {
    query.mockImplementation(async (ip) => [ip === "8.8.8.8" ? "192.0.2.1" : "192.0.2.2"]);
    expect(await dnsCheckPropagationTool.handler(input())).toMatchObject({ agree: false });
  });

  it("does not count matching failures as agreement", async () => {
    query.mockRejectedValue(new Error("ENOTFOUND"));
    expect(await dnsCheckPropagationTool.handler(input())).toMatchObject({
      agree: false,
      results: expect.arrayContaining([
        { resolver: "google", ip: "8.8.8.8", answers: [], error: "ENOTFOUND" },
      ]),
    });
  });

  it("keeps successful answers when one resolver times out", async () => {
    query.mockImplementation(async (ip) => {
      if (ip === "8.8.8.8") throw new Error("ETIMEOUT");
      return ["192.0.2.1"];
    });
    expect(await dnsCheckPropagationTool.handler(input())).toMatchObject({
      agree: false,
      results: expect.arrayContaining([
        expect.objectContaining({ resolver: "cloudflare", answers: ["192.0.2.1"], error: null }),
      ]),
    });
  });

  it("does not count empty answers as agreement", async () => {
    query.mockResolvedValue([]);
    expect(await dnsCheckPropagationTool.handler(input())).toMatchObject({ agree: false });
  });

  it("joins TXT chunks without losing case", async () => {
    query.mockImplementation(async (ip) => (ip === "8.8.8.8" ? [["Va", "lue"]] : [["Value"]]));
    expect(await dnsCheckPropagationTool.handler(input("TXT"))).toMatchObject({ agree: true });
    query.mockImplementation(async (ip) => (ip === "8.8.8.8" ? [["Value"]] : [["value"]]));
    expect(await dnsCheckPropagationTool.handler(input("TXT"))).toMatchObject({ agree: false });
  });

  it("normalizes MX hostname case and trailing dots while retaining priority", async () => {
    query.mockImplementation(async (ip) => [
      { priority: 5, exchange: ip === "8.8.8.8" ? "MAIL.EXAMPLE.COM." : "mail.example.com" },
    ]);
    expect(await dnsCheckPropagationTool.handler(input("MX"))).toMatchObject({ agree: true });
    query.mockImplementation(async (ip) => [
      { priority: ip === "8.8.8.8" ? 5 : 10, exchange: "mail.example.com" },
    ]);
    expect(await dnsCheckPropagationTool.handler(input("MX"))).toMatchObject({ agree: false });
  });
});
