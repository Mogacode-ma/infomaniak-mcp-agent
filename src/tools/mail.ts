/**
 * Mail tools — read against the documented `/1/mail_hostings/...` API.
 *
 * v0.2 ships read-only mail tools. Mailbox creation, alias management,
 * autoresponders, signatures and backups will follow once we stabilize
 * the schemas and add destructive-operation tests.
 */
import { z } from "zod";

import { PublicApiClient } from "../api/http.js";
import { MailHostingSchema, MailboxSchema, ProductSchema } from "../types/infomaniak.js";
import { defaultAccountId } from "../utils/accounts.js";

import { defineTool } from "./types.js";

// ---------------------------------------------------------------------------
// list_mail_hostings
// ---------------------------------------------------------------------------

const ListMailHostingsInput = z.object({
  account_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Organization/account ID. Optional: defaults to the first account the token has access to. Discover via infomaniak_overview.",
    ),
});

const ListMailHostingsOutput = z.object({
  account_id: z.number(),
  count: z.number(),
  mail_hostings: z.array(MailHostingSchema),
});

export const listMailHostingsTool = defineTool({
  name: "infomaniak_list_mail_hostings",
  description:
    "List every mail hosting (a.k.a. email_hosting) attached to an Infomaniak organization.",
  inputSchema: ListMailHostingsInput,
  outputSchema: ListMailHostingsOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input) => {
    const accountId = input.account_id ?? (await defaultAccountId());
    if (accountId === null) {
      throw new Error(
        "No account_id provided and the token reaches no accounts. Use infomaniak_overview to list available accounts.",
      );
    }
    const client = new PublicApiClient();
    const products = await client.request<Array<unknown>>("GET", "/1/products", {
      query: { per_page: 500, account_id: accountId },
    });
    const mailHostings = products
      .map((p) => ProductSchema.parse(p))
      .filter((p) => p.account_id === accountId && p.service_name === "email_hosting")
      .map((p) =>
        MailHostingSchema.parse({
          id: p.id,
          account_id: p.account_id,
          service_name: p.service_name,
          customer_name: p.customer_name,
          has_maintenance: p.has_maintenance,
          is_locked: p.is_locked,
          has_operation_in_progress: p.has_operation_in_progress,
        }),
      );
    return {
      account_id: accountId,
      count: mailHostings.length,
      mail_hostings: mailHostings,
    };
  },
});

// ---------------------------------------------------------------------------
// list_mailboxes
// ---------------------------------------------------------------------------

const ListMailboxesInput = z.object({
  mail_hosting_id: z.number().int().positive(),
});

const ListMailboxesOutput = z.object({
  mail_hosting_id: z.number(),
  count: z.number(),
  mailboxes: z.array(MailboxSchema),
});

export const listMailboxesTool = defineTool({
  name: "infomaniak_list_mailboxes",
  description: "List every mailbox on a given mail hosting.",
  inputSchema: ListMailboxesInput,
  outputSchema: ListMailboxesOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input) => {
    const client = new PublicApiClient();
    const mailboxes = await client.request<Array<unknown>>(
      "GET",
      `/1/mail_hostings/${input.mail_hosting_id}/mailboxes`,
    );
    const parsed = mailboxes.map((m) => MailboxSchema.parse(m));
    return {
      mail_hosting_id: input.mail_hosting_id,
      count: parsed.length,
      mailboxes: parsed,
    };
  },
});

// ---------------------------------------------------------------------------
// get_mailbox_aliases — REMOVED in v0.10. Replaced by `infomaniak_get_mailbox_info`
// which fetches aliases / signatures / backups in a single tool call. See
// `src/tools/mail-extras.ts`.
