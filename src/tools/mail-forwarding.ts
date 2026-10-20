/**
 * Mailbox forwarding tools — read, add and remove forwarding addresses.
 *
 * Not to be confused with mail redirections (`infomaniak_*_redirection`),
 * which are server-side rules on a mail hosting. These act on one mailbox.
 *
 * Endpoints (add and remove verified live against a real mailbox):
 *
 *   GET    /1/mail_hostings/{id}/mailboxes/{name}/forwarding_addresses
 *   POST   /1/mail_hostings/{id}/mailboxes/{name}/forwarding_addresses   { redirect_address }
 *   DELETE /1/mail_hostings/{id}/mailboxes/{name}/forwarding_addresses/{address}
 *
 * The GET response spells the list `redirect_adresses` (sic) and returns
 * the flags as booleans or as the strings "0" / "1".
 */
import { z } from "zod";

import { PublicApiClient } from "../api/http.js";
import { consumeToken, mintToken } from "../utils/confirmation.js";
import { recordHistory } from "../utils/history.js";

import { defineTool } from "./types.js";

const MailboxInput = {
  mail_hosting_id: z
    .number()
    .int()
    .positive()
    .describe("Mail hosting ID. Discover via infomaniak_list_mail_hostings."),
  mailbox_name: z
    .string()
    .min(1)
    .describe("Local part of the mailbox (before the @), NOT the full email address."),
};

const AddressInput = z
  .string()
  .email()
  .describe("Full email address to forward to, e.g. 'me@example.net'.");

/** The API sends flags as booleans or "0"/"1"; `Boolean("0")` would be true. */
const Flag = z
  .union([z.boolean(), z.string(), z.number()])
  .transform((value) => value === true || value === 1 || value === "1" || value === "true");

const ForwardingSchema = z
  .object({
    is_enabled: Flag,
    has_dont_deliver: Flag,
    has_forward_spam: Flag,
    redirect_adresses: z.array(z.object({ email: z.string() }).passthrough()).default([]),
  })
  .passthrough();

const forwardingPath = (hostingId: number, mailbox: string): string =>
  `/1/mail_hostings/${hostingId}/mailboxes/${encodeURIComponent(mailbox)}/forwarding_addresses`;

// ---------------------------------------------------------------------------
// get_mailbox_forwarding
// ---------------------------------------------------------------------------

export const getMailboxForwardingTool = defineTool({
  name: "infomaniak_get_mailbox_forwarding",
  description:
    "Read a mailbox's forwarding: the addresses it forwards to, whether forwarding is enabled, whether the local copy is dropped after forwarding, and whether spam is forwarded.",
  inputSchema: z.object(MailboxInput),
  outputSchema: z.object({
    mail_hosting_id: z.number(),
    mailbox_name: z.string(),
    is_enabled: z.boolean(),
    delete_local_copy: z.boolean(),
    forward_spam: z.boolean(),
    addresses: z.array(z.string()),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input) => {
    const client = new PublicApiClient();
    const data = ForwardingSchema.parse(
      await client.request<unknown>(
        "GET",
        forwardingPath(input.mail_hosting_id, input.mailbox_name),
      ),
    );
    return {
      mail_hosting_id: input.mail_hosting_id,
      mailbox_name: input.mailbox_name,
      is_enabled: data.is_enabled,
      delete_local_copy: data.has_dont_deliver,
      forward_spam: data.has_forward_spam,
      addresses: data.redirect_adresses.map((entry) => entry.email),
    };
  },
});

// ---------------------------------------------------------------------------
// add / remove
// ---------------------------------------------------------------------------

const WriteInput = z.object({
  ...MailboxInput,
  address: AddressInput,
  confirmation_token: z.string().uuid().optional(),
});

const WriteOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      mail_hosting_id: z.number(),
      mailbox_name: z.string(),
      address: z.string(),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    address: z.string(),
    message: z.string(),
  }),
]);

type WriteInputType = z.infer<typeof WriteInput>;

function fingerprintOf(tool: string, input: WriteInputType): string {
  return JSON.stringify({
    tool,
    mail_hosting_id: input.mail_hosting_id,
    mailbox_name: input.mailbox_name,
    address: input.address,
  });
}

export const addMailboxForwardingTool = defineTool({
  name: "infomaniak_add_mailbox_forwarding",
  description:
    "Forward a mailbox's mail to another address. Two-phase commit. A mistyped address sends the mailbox's mail to someone else, so check the plan. Undo with infomaniak_delete_mailbox_forwarding.",
  inputSchema: WriteInput,
  outputSchema: WriteOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: async (input) => {
    const fingerprint = fingerprintOf("infomaniak_add_mailbox_forwarding", input);
    if (!input.confirmation_token) {
      const { token, expiresAt } = mintToken(fingerprint);
      return {
        status: "plan" as const,
        plan: {
          mail_hosting_id: input.mail_hosting_id,
          mailbox_name: input.mailbox_name,
          address: input.address,
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — add forwarding`,
          ``,
          `- **Mailbox**: \`${input.mailbox_name}\``,
          `- **Forward to**: \`${input.address}\``,
          ``,
          `Mail for this mailbox will be sent to that address. Check the spelling.`,
          ``,
          `### Next step`,
          `Re-call with \`confirmation_token: "${token}"\`.`,
        ].join("\n"),
      };
    }
    if (!consumeToken(input.confirmation_token, fingerprint)) {
      throw new Error("Confirmation token is invalid, expired, or doesn't match the parameters.");
    }
    const client = new PublicApiClient();
    await client.request<unknown>(
      "POST",
      forwardingPath(input.mail_hosting_id, input.mailbox_name),
      { body: { redirect_address: input.address } },
    );
    recordHistory({
      tool: "infomaniak_add_mailbox_forwarding",
      kind: "create_mail_forwarding",
      summary: `Forwarding ${input.mailbox_name} to ${input.address}`,
      payload: {
        mail_hosting_id: input.mail_hosting_id,
        mailbox_name: input.mailbox_name,
        address: input.address,
      },
      undo: {
        tool: "infomaniak_delete_mailbox_forwarding",
        params: {
          mail_hosting_id: input.mail_hosting_id,
          mailbox_name: input.mailbox_name,
          address: input.address,
        },
        description: `Stop forwarding ${input.mailbox_name} to ${input.address}`,
      },
    });
    return {
      status: "applied" as const,
      address: input.address,
      message: `✅ Mailbox \`${input.mailbox_name}\` now forwards to \`${input.address}\`.`,
    };
  },
});

export const deleteMailboxForwardingTool = defineTool({
  name: "infomaniak_delete_mailbox_forwarding",
  description:
    "Stop forwarding a mailbox's mail to an address. Two-phase commit. Undo with infomaniak_add_mailbox_forwarding.",
  inputSchema: WriteInput,
  outputSchema: WriteOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const fingerprint = fingerprintOf("infomaniak_delete_mailbox_forwarding", input);
    if (!input.confirmation_token) {
      const { token, expiresAt } = mintToken(fingerprint);
      return {
        status: "plan" as const,
        plan: {
          mail_hosting_id: input.mail_hosting_id,
          mailbox_name: input.mailbox_name,
          address: input.address,
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — stop forwarding`,
          ``,
          `- **Mailbox**: \`${input.mailbox_name}\``,
          `- **Stop forwarding to**: \`${input.address}\``,
          ``,
          `### Next step`,
          `Re-call with \`confirmation_token: "${token}"\`.`,
        ].join("\n"),
      };
    }
    if (!consumeToken(input.confirmation_token, fingerprint)) {
      throw new Error("Confirmation token is invalid, expired, or doesn't match the parameters.");
    }
    const client = new PublicApiClient();
    await client.request<unknown>(
      "DELETE",
      `${forwardingPath(input.mail_hosting_id, input.mailbox_name)}/${encodeURIComponent(input.address)}`,
    );
    recordHistory({
      tool: "infomaniak_delete_mailbox_forwarding",
      kind: "delete_mail_forwarding",
      summary: `Stopped forwarding ${input.mailbox_name} to ${input.address}`,
      payload: {
        mail_hosting_id: input.mail_hosting_id,
        mailbox_name: input.mailbox_name,
        address: input.address,
      },
      undo: {
        tool: "infomaniak_add_mailbox_forwarding",
        params: {
          mail_hosting_id: input.mail_hosting_id,
          mailbox_name: input.mailbox_name,
          address: input.address,
        },
        description: `Forward ${input.mailbox_name} to ${input.address} again`,
      },
    });
    return {
      status: "applied" as const,
      address: input.address,
      message: `✅ Mailbox \`${input.mailbox_name}\` no longer forwards to \`${input.address}\`.`,
    };
  },
});
