import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { _resetConfigCache } from "../../src/config.js";
import { deleteAliasTool } from "../../src/tools/mail-write.js";
import { _resetTokens } from "../../src/utils/confirmation.js";
import { listHistory } from "../../src/utils/history.js";

const ALIAS_URL = "https://api.infomaniak.com/1/mail_hostings/42/mailboxes/info/aliases/sales";
const input = { mail_hosting_id: 42, mailbox_name: "info", alias: "sales" };

const calls: string[] = [];
const server = setupServer(
  http.delete(ALIAS_URL, ({ request }) => {
    calls.push(`${request.method} ${new URL(request.url).pathname}`);
    return HttpResponse.json({ result: "success", data: true });
  }),
);

describe("infomaniak_delete_mailbox_alias", () => {
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterAll(() => server.close());

  beforeEach(() => {
    process.env["INFOMANIAK_API_TOKEN"] = "x".repeat(40);
    _resetConfigCache();
    _resetTokens();
    calls.length = 0;
  });

  afterEach(() => server.resetHandlers());

  it("rejects an alias that includes the domain", () => {
    expect(() =>
      deleteAliasTool.inputSchema.parse({ ...input, alias: "sales@example.com" }),
    ).toThrow(/alias must be/);
  });

  it("plans first and sends nothing", async () => {
    const result = (await deleteAliasTool.handler(input)) as { status: string };

    expect(result.status).toBe("plan");
    expect(calls).toEqual([]);
  });

  it("deletes the alias with the token and records an undo", async () => {
    const plan = (await deleteAliasTool.handler(input)) as { confirmation_token: string };

    const result = (await deleteAliasTool.handler({
      ...input,
      confirmation_token: plan.confirmation_token,
    })) as { status: string };

    expect(result.status).toBe("applied");
    expect(calls).toEqual(["DELETE /1/mail_hostings/42/mailboxes/info/aliases/sales"]);
    expect(listHistory()[0]?.undo?.tool).toBe("infomaniak_create_mailbox_alias");
  });

  it("refuses a token minted for a different alias", async () => {
    const plan = (await deleteAliasTool.handler({ ...input, alias: "other" })) as {
      confirmation_token: string;
    };

    await expect(
      deleteAliasTool.handler({ ...input, confirmation_token: plan.confirmation_token }),
    ).rejects.toThrow(/Confirmation token/);
    expect(calls).toEqual([]);
  });

  it("surfaces an API error for an unknown alias", async () => {
    server.use(
      http.delete(ALIAS_URL, () =>
        HttpResponse.json(
          {
            result: "error",
            error: { code: "alias_does_not_exist", description: "Alias does not exist" },
          },
          { status: 400 },
        ),
      ),
    );
    const plan = (await deleteAliasTool.handler(input)) as { confirmation_token: string };

    await expect(
      deleteAliasTool.handler({ ...input, confirmation_token: plan.confirmation_token }),
    ).rejects.toThrow();
  });
});
