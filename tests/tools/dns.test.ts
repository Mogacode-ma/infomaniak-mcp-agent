import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  dnsCreateRecordTool,
  dnsDeleteRecordTool,
  dnsListRecordsTool,
  dnsUpdateRecordTool,
} from "../../src/tools/dns.js";
import type { ToolDefinition } from "../../src/tools/types.js";
import { _resetTokens } from "../../src/utils/confirmation.js";
import { _resetHistory, listHistory } from "../../src/utils/history.js";

vi.mock("../../src/throttle/token-bucket.js", () => ({
  createDefaultThrottle: () => ({ acquire: async () => undefined }),
}));

const server = setupServer();
const collection = "https://api.infomaniak.com/2/zones/example.com/records";
const record = { id: 7, source: ".", type: "A", target: "192.0.2.1", ttl: 300 };

async function invoke(tool: ToolDefinition, input: unknown): Promise<unknown> {
  const result = await tool.handler(tool.inputSchema.parse(input));
  return tool.outputSchema?.parse(result);
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  _resetTokens();
  _resetHistory();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("DNS tools", () => {
  it.each([dnsListRecordsTool, dnsCreateRecordTool, dnsUpdateRecordTool, dnsDeleteRecordTool])(
    "rejects invalid input: $name",
    (tool) => {
      expect(tool.inputSchema.safeParse({ zone: "", record_id: -1 }).success).toBe(false);
    },
  );

  it("lists and validates records", async () => {
    server.use(
      http.get(collection, () => HttpResponse.json({ result: "success", data: [record] })),
    );
    expect(await invoke(dnsListRecordsTool, { zone: "example.com" })).toEqual({
      zone: "example.com",
      count: 1,
      records: [record],
    });
  });

  it("propagates read failures", async () => {
    server.use(
      http.get(collection, () =>
        HttpResponse.json({ result: "error", error: { code: "forbidden" } }, { status: 403 }),
      ),
    );
    await expect(invoke(dnsListRecordsTool, { zone: "example.com" })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("creates only after confirmation and records an undo", async () => {
    const write = vi.fn();
    server.use(
      http.post(collection, async ({ request }) => {
        write(await request.json());
        return HttpResponse.json({ result: "success", data: record });
      }),
    );
    const input = { zone: "example.com", source: ".", type: "A", target: "192.0.2.1", ttl: 300 };
    const plan = (await invoke(dnsCreateRecordTool, input)) as { confirmation_token: string };
    expect(write).not.toHaveBeenCalled();
    const apply = { ...input, confirmation_token: plan.confirmation_token };
    expect(await invoke(dnsCreateRecordTool, apply)).toMatchObject({ status: "applied", record });
    expect(write).toHaveBeenCalledWith({ source: ".", type: "A", target: "192.0.2.1", ttl: 300 });
    expect(listHistory()[0]?.undo).toMatchObject({
      tool: "infomaniak_dns_delete_record",
      params: { zone: "example.com", record_id: 7 },
    });
    await expect(invoke(dnsCreateRecordTool, apply)).rejects.toThrow(/token/i);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("rejects a confirmation when the target changes", async () => {
    const input = { zone: "example.com", source: ".", type: "A", target: "192.0.2.1", ttl: 300 };
    const plan = (await invoke(dnsCreateRecordTool, input)) as { confirmation_token: string };
    await expect(
      invoke(dnsCreateRecordTool, {
        ...input,
        target: "192.0.2.2",
        confirmation_token: plan.confirmation_token,
      }),
    ).rejects.toThrow(/token/i);
    expect(listHistory()).toHaveLength(0);
  });

  it("previews a TTL-only update and sends only that patch", async () => {
    const write = vi.fn();
    server.use(
      http.get(`${collection}/7`, () => HttpResponse.json({ result: "success", data: record })),
      http.put(`${collection}/7`, async ({ request }) => {
        write(await request.json());
        return HttpResponse.json({ result: "success", data: { ...record, ttl: 600 } });
      }),
    );
    const input = { zone: "example.com", record_id: 7, ttl: 600 };
    const plan = (await invoke(dnsUpdateRecordTool, input)) as { confirmation_token: string };
    expect(plan).toMatchObject({
      status: "plan",
      plan: {
        before: record,
        after_preview: { source: ".", type: "A", target: "192.0.2.1", ttl: 600 },
      },
    });
    expect(write).not.toHaveBeenCalled();
    expect(
      await invoke(dnsUpdateRecordTool, { ...input, confirmation_token: plan.confirmation_token }),
    ).toMatchObject({ status: "applied", record: { ...record, ttl: 600 } });
    expect(write).toHaveBeenCalledWith({ ttl: 600 });
  });

  it("previews a delete and applies it only once", async () => {
    const write = vi.fn();
    server.use(
      http.get(`${collection}/7`, () => HttpResponse.json({ result: "success", data: record })),
      http.delete(`${collection}/7`, () => {
        write();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const input = { zone: "example.com", record_id: 7 };
    const plan = (await invoke(dnsDeleteRecordTool, input)) as { confirmation_token: string };
    expect(plan).toMatchObject({ status: "plan", plan: { record_preview: record } });
    expect(write).not.toHaveBeenCalled();
    const apply = { ...input, confirmation_token: plan.confirmation_token };
    expect(await invoke(dnsDeleteRecordTool, apply)).toMatchObject({
      status: "applied",
      deleted_record_id: 7,
    });
    await expect(invoke(dnsDeleteRecordTool, apply)).rejects.toThrow(/token/i);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("does not record a successful mutation when the API rejects it", async () => {
    server.use(
      http.post(collection, () =>
        HttpResponse.json({ result: "error", error: { code: "forbidden" } }, { status: 403 }),
      ),
    );
    const input = { zone: "example.com", source: ".", type: "A", target: "192.0.2.1", ttl: 300 };
    const plan = (await invoke(dnsCreateRecordTool, input)) as { confirmation_token: string };
    await expect(
      invoke(dnsCreateRecordTool, { ...input, confirmation_token: plan.confirmation_token }),
    ).rejects.toMatchObject({ status: 403 });
    expect(listHistory()).toHaveLength(0);
  });

  it("does not mint a delete plan when the record is missing", async () => {
    server.use(
      http.get(`${collection}/7`, () =>
        HttpResponse.json(
          { result: "error", error: { code: "object_not_found" } },
          { status: 404 },
        ),
      ),
    );
    await expect(
      invoke(dnsDeleteRecordTool, { zone: "example.com", record_id: 7 }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
