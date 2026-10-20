import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { getMailboxInfoTool } from "../../src/tools/mail-extras.js";
import { listMailboxesTool, listMailHostingsTool } from "../../src/tools/mail.js";

vi.mock("../../src/throttle/token-bucket.js", () => ({
  createDefaultThrottle: () => ({ acquire: async () => undefined }),
}));

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("mail reads", () => {
  it.each([listMailHostingsTool, listMailboxesTool, getMailboxInfoTool])(
    "rejects invalid input: $name",
    (tool) => {
      expect(tool.inputSchema.safeParse({ mail_hosting_id: -1, account_id: -1 }).success).toBe(
        false,
      );
    },
  );

  it("filters mail hosting products to the selected account", async () => {
    const product = {
      id: 1,
      account_id: 10,
      service_id: 7,
      service_name: "email_hosting",
      customer_name: "example.com",
    };
    server.use(
      http.get("https://api.infomaniak.com/1/products", ({ request }) => {
        expect(new URL(request.url).searchParams.get("account_id")).toBe("10");
        return HttpResponse.json({
          result: "success",
          data: [product, { ...product, account_id: 20 }, { ...product, service_name: "hosting" }],
        });
      }),
    );
    const result = await listMailHostingsTool.handler({ account_id: 10 });
    expect(result).toMatchObject({ account_id: 10, count: 1, mail_hostings: [{ id: 1 }] });
    expect(listMailHostingsTool.outputSchema?.safeParse(result).success).toBe(true);
  });

  it("accepts numeric and null mailbox types", async () => {
    server.use(
      http.get("https://api.infomaniak.com/1/mail_hostings/1/mailboxes", () =>
        HttpResponse.json({
          result: "success",
          data: [
            { mailbox_name: "alice", type: 1 },
            { mailbox_name: "bob", type: null },
          ],
        }),
      ),
    );
    expect(await listMailboxesTool.handler({ mail_hosting_id: 1 })).toMatchObject({
      count: 2,
      mailboxes: [{ type: 1 }, { type: null }],
    });
  });

  it("returns an empty hosting without inventing mailboxes", async () => {
    server.use(
      http.get("https://api.infomaniak.com/1/mail_hostings/1/mailboxes", () =>
        HttpResponse.json({ result: "success", data: [] }),
      ),
    );
    expect(await listMailboxesTool.handler({ mail_hosting_id: 1 })).toEqual({
      mail_hosting_id: 1,
      count: 0,
      mailboxes: [],
    });
  });

  it("propagates mailbox authorization failures", async () => {
    server.use(
      http.get("https://api.infomaniak.com/1/mail_hostings/1/mailboxes", () =>
        HttpResponse.json({ result: "error", error: { code: "forbidden" } }, { status: 403 }),
      ),
    );
    await expect(listMailboxesTool.handler({ mail_hosting_id: 1 })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("fetches only selected metadata sections and handles numeric alias flags", async () => {
    server.use(
      http.get("https://api.infomaniak.com/1/mail_hostings/1/mailboxes/alice/aliases", () =>
        HttpResponse.json({
          result: "success",
          data: { enabled_alias: 0, aliases: ["hello@example.com"] },
        }),
      ),
    );
    expect(
      await getMailboxInfoTool.handler({
        mail_hosting_id: 1,
        mailbox_name: "alice",
        fields: ["aliases"],
      }),
    ).toEqual({
      mail_hosting_id: 1,
      mailbox_name: "alice",
      fields: ["aliases"],
      aliases: { enabled_alias: false, aliases: ["hello@example.com"] },
    });
  });

  it("preserves successful sections and exposes errors for failed sections", async () => {
    server.use(
      http.get("https://api.infomaniak.com/1/mail_hostings/1/mailboxes/alice/aliases", () =>
        HttpResponse.json({ result: "success", data: { aliases: [] } }),
      ),
      http.get("https://api.infomaniak.com/1/mail_hostings/1/mailboxes/alice/signatures", () =>
        HttpResponse.json({ result: "error", error: { code: "forbidden" } }, { status: 403 }),
      ),
    );
    const result = await getMailboxInfoTool.handler({
      mail_hosting_id: 1,
      mailbox_name: "alice",
      fields: ["aliases", "signatures"],
    });
    expect(result).toMatchObject({
      aliases: { aliases: [] },
      errors: { signatures: expect.any(String) },
    });
    expect(getMailboxInfoTool.outputSchema?.safeParse(result).success).toBe(true);
  });
});
