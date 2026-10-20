import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { _resetConfigCache } from "../../src/config.js";
import {
  addMailboxForwardingTool,
  deleteMailboxForwardingTool,
  getMailboxForwardingTool,
} from "../../src/tools/mail-forwarding.js";
import { _resetTokens } from "../../src/utils/confirmation.js";
import { listHistory } from "../../src/utils/history.js";

const BASE = "https://api.infomaniak.com/1/mail_hostings/42/mailboxes/info/forwarding_addresses";
const input = { mail_hosting_id: 42, mailbox_name: "info", address: "me@example.net" };

const requests: Array<{ method: string; path: string; body: unknown }> = [];
let forwarding: unknown = {};

const server = setupServer(
  http.get(BASE, () => HttpResponse.json({ result: "success", data: forwarding })),
  http.post(BASE, async ({ request }) => {
    requests.push({
      method: "POST",
      path: new URL(request.url).pathname,
      body: await request.json(),
    });
    return HttpResponse.json(
      { result: "success", data: { email: "me@example.net" } },
      { status: 201 },
    );
  }),
  http.delete(`${BASE}/:address`, ({ request }) => {
    requests.push({ method: "DELETE", path: new URL(request.url).pathname, body: null });
    return HttpResponse.json({ result: "success", data: true });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

beforeEach(() => {
  process.env["INFOMANIAK_API_TOKEN"] = "x".repeat(40);
  _resetConfigCache();
  _resetTokens();
  requests.length = 0;
});

afterEach(() => server.resetHandlers());

describe("infomaniak_get_mailbox_forwarding", () => {
  it('reads "0"/"1" string flags as booleans', async () => {
    forwarding = {
      is_enabled: "1",
      has_dont_deliver: "0",
      has_forward_spam: "0",
      redirect_adresses: [{ email: "me@example.net", email_idn: "me@example.net" }],
    };

    const result = await getMailboxForwardingTool.handler({
      mail_hosting_id: 42,
      mailbox_name: "info",
    });

    expect(result).toMatchObject({
      is_enabled: true,
      delete_local_copy: false,
      forward_spam: false,
      addresses: ["me@example.net"],
    });
  });

  it("reads boolean flags and an empty list", async () => {
    forwarding = {
      is_enabled: false,
      has_dont_deliver: true,
      has_forward_spam: false,
      redirect_adresses: [],
    };

    const result = await getMailboxForwardingTool.handler({
      mail_hosting_id: 42,
      mailbox_name: "info",
    });

    expect(result).toMatchObject({ is_enabled: false, delete_local_copy: true, addresses: [] });
  });
});

describe.each([
  ["add", addMailboxForwardingTool, "POST", "infomaniak_delete_mailbox_forwarding"],
  ["delete", deleteMailboxForwardingTool, "DELETE", "infomaniak_add_mailbox_forwarding"],
] as const)("%s forwarding", (_name, tool, method, undoTool) => {
  it("rejects an address that is not an email", () => {
    expect(() => tool.inputSchema.parse({ ...input, address: "nobody" })).toThrow();
  });

  it("plans first and sends nothing", async () => {
    const result = (await tool.handler(input)) as { status: string };

    expect(result.status).toBe("plan");
    expect(requests).toEqual([]);
  });

  it("applies with the token and records the reverse as undo", async () => {
    const plan = (await tool.handler(input)) as { confirmation_token: string };

    const result = (await tool.handler({
      ...input,
      confirmation_token: plan.confirmation_token,
    })) as { status: string };

    expect(result.status).toBe("applied");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe(method);
    expect(listHistory()[0]?.undo?.tool).toBe(undoTool);
  });

  it("refuses a token minted for a different address", async () => {
    const plan = (await tool.handler({ ...input, address: "other@example.net" })) as {
      confirmation_token: string;
    };

    await expect(
      tool.handler({ ...input, confirmation_token: plan.confirmation_token }),
    ).rejects.toThrow(/Confirmation token/);
    expect(requests).toEqual([]);
  });
});

describe("request shapes", () => {
  it("sends redirect_address when adding", async () => {
    const plan = (await addMailboxForwardingTool.handler(input)) as { confirmation_token: string };
    await addMailboxForwardingTool.handler({
      ...input,
      confirmation_token: plan.confirmation_token,
    });

    expect(requests[0]?.body).toEqual({ redirect_address: "me@example.net" });
  });

  it("URL-encodes the address when deleting", async () => {
    const plan = (await deleteMailboxForwardingTool.handler(input)) as {
      confirmation_token: string;
    };
    await deleteMailboxForwardingTool.handler({
      ...input,
      confirmation_token: plan.confirmation_token,
    });

    expect(requests[0]?.path).toBe(
      "/1/mail_hostings/42/mailboxes/info/forwarding_addresses/me%40example.net",
    );
  });
});
