/**
 * Mail write tools — create / delete mailboxes, aliases and redirections.
 *
 * All operations follow the agentic two-phase commit pattern: the first
 * call returns a plan + token, the second call applies the change.
 *
 * Endpoints used (every base path verified live as a GET; payload field
 * lists discovered via 422 responses against empty POSTs):
 *
 *   POST   /1/mail_hostings/{id}/mailboxes
 *   DELETE /1/mail_hostings/{id}/mailboxes/{name}
 *   POST   /1/mail_hostings/{id}/mailboxes/{name}/aliases
 *   DELETE /1/mail_hostings/{id}/mailboxes/{name}/aliases/{alias}
 *   POST   /1/mail_hostings/{id}/redirections
 *   DELETE /1/mail_hostings/{id}/redirections/{redirection_id}
 */
import { z } from "zod";

import { PublicApiClient } from "../api/http.js";
import { consumeToken, mintToken } from "../utils/confirmation.js";
import { recordHistory } from "../utils/history.js";

import { defineTool } from "./types.js";

// ---------------------------------------------------------------------------
// create_mailbox
// ---------------------------------------------------------------------------

const CreateMailboxInput = z.object({
  mail_hosting_id: z
    .number()
    .int()
    .positive()
    .describe("Mail hosting ID. Discover via infomaniak_list_mail_hostings."),
  mailbox_name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9._-]+$/, "mailbox_name must be lowercase alphanumeric with . _ -")
    .describe(
      "Local part of the mailbox WITHOUT the @domain (e.g. 'info', NOT 'info@example.com'). Lowercase alphanumeric with dots, underscores or dashes; 1-64 chars.",
    ),
  password: z
    .string()
    .min(8)
    .regex(/[a-z]/, "password must contain at least one lowercase letter")
    .regex(/[A-Z]/, "password must contain at least one uppercase letter")
    .regex(/\d/, "password must contain at least one digit")
    .regex(/[^A-Za-z0-9]/, "password must contain at least one special character")
    .describe(
      "Initial mailbox password. Infomaniak policy: ≥ 8 chars, at least one lowercase, one uppercase, one digit and one special character. NEVER appears in the plan response — only in the apply call.",
    ),
  description: z
    .string()
    .max(255)
    .optional()
    .describe("Optional free-text description (≤ 255 chars), shown in the manager UI."),
  confirmation_token: z
    .string()
    .uuid()
    .optional()
    .describe("Token from the prior plan response. Required on the apply phase only."),
});

const CreateMailboxOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      mail_hosting_id: z.number(),
      mailbox_name: z.string(),
      description: z.string().optional(),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    mailbox_name: z.string(),
    mail_hosting_id: z.number(),
    message: z.string(),
  }),
]);

export const createMailboxTool = defineTool({
  name: "infomaniak_create_mailbox",
  description:
    "Create a new mailbox on a mail hosting. Two-phase commit: plan + token first, then apply with token. The password never appears in the plan output.",
  inputSchema: CreateMailboxInput,
  outputSchema: CreateMailboxOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: async (input) => {
    // Fingerprint deliberately excludes the password so a "plan with bad
    // password / apply with corrected password" flow stays valid. The
    // user re-types the password and the plan still matches.
    const fingerprint = JSON.stringify({
      tool: "infomaniak_create_mailbox",
      mail_hosting_id: input.mail_hosting_id,
      mailbox_name: input.mailbox_name,
    });

    if (!input.confirmation_token) {
      const { token, expiresAt } = mintToken(fingerprint);
      return {
        status: "plan" as const,
        plan: {
          mail_hosting_id: input.mail_hosting_id,
          mailbox_name: input.mailbox_name,
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — create mailbox`,
          ``,
          `- **Mail hosting**: ${input.mail_hosting_id}`,
          `- **Mailbox**: \`${input.mailbox_name}@…\``,
          ...(input.description ? [`- **Description**: ${input.description}`] : []),
          ``,
          `### Side effects`,
          `- A new IMAP/SMTP mailbox will be provisioned within seconds.`,
          `- The user can connect immediately with the password you provided.`,
          ``,
          `### Next step`,
          `Re-call \`infomaniak_create_mailbox\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
        ].join("\n"),
      };
    }

    if (!consumeToken(input.confirmation_token, fingerprint)) {
      throw new Error("Confirmation token is invalid, expired, or doesn't match the parameters.");
    }
    const client = new PublicApiClient();
    const payload: Record<string, unknown> = {
      mailbox_name: input.mailbox_name,
      password: input.password,
    };
    if (input.description !== undefined) {
      payload["description"] = input.description;
    }
    await client.request<unknown>("POST", `/1/mail_hostings/${input.mail_hosting_id}/mailboxes`, {
      body: payload,
    });
    recordHistory({
      tool: "infomaniak_create_mailbox",
      kind: "create_site", // closest existing kind; specific mailbox kind can be added later
      summary: `Created mailbox ${input.mailbox_name} on mail_hosting ${input.mail_hosting_id}`,
      payload: {
        mail_hosting_id: input.mail_hosting_id,
        mailbox_name: input.mailbox_name,
        // password intentionally NOT recorded
      },
      undo: {
        tool: "infomaniak_delete_mailbox",
        params: {
          mail_hosting_id: input.mail_hosting_id,
          mailbox_name: input.mailbox_name,
        },
        description: `Delete mailbox ${input.mailbox_name}`,
      },
    });
    return {
      status: "applied" as const,
      mailbox_name: input.mailbox_name,
      mail_hosting_id: input.mail_hosting_id,
      message: `✅ Mailbox \`${input.mailbox_name}\` created.`,
    };
  },
});

// ---------------------------------------------------------------------------
// delete_mailbox
// ---------------------------------------------------------------------------

const DeleteMailboxInput = z.object({
  mail_hosting_id: z
    .number()
    .int()
    .positive()
    .describe("Mail hosting ID. Discover via infomaniak_list_mail_hostings."),
  mailbox_name: z
    .string()
    .min(1)
    .describe(
      "Local part of the mailbox WITHOUT the @domain (e.g. 'anthony' for anthony@example.com). NOT the full email address. Verify with infomaniak_list_mailboxes before deleting — this wipes stored mail.",
    ),
  confirmation_token: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Token from the first (plan) phase. The plan response shows the mailbox + a warning that stored mail will be wiped. Re-pass to execute.",
    ),
});

const DeleteMailboxOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      mail_hosting_id: z.number(),
      mailbox_name: z.string(),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    mailbox_name: z.string(),
    message: z.string(),
  }),
]);

export const deleteMailboxTool = defineTool({
  name: "infomaniak_delete_mailbox",
  description:
    "Delete a mailbox. Two-phase commit. WARNING: this also deletes all stored emails for that mailbox.",
  inputSchema: DeleteMailboxInput,
  outputSchema: DeleteMailboxOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const fingerprint = JSON.stringify({
      tool: "infomaniak_delete_mailbox",
      mail_hosting_id: input.mail_hosting_id,
      mailbox_name: input.mailbox_name,
    });
    if (!input.confirmation_token) {
      const { token, expiresAt } = mintToken(fingerprint);
      return {
        status: "plan" as const,
        plan: {
          mail_hosting_id: input.mail_hosting_id,
          mailbox_name: input.mailbox_name,
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — delete mailbox`,
          ``,
          `- **Mail hosting**: ${input.mail_hosting_id}`,
          `- **Mailbox**: \`${input.mailbox_name}@…\``,
          ``,
          `### ⚠️ Irreversible`,
          `All stored mails (inbox, sent, drafts, spam) for this mailbox will be deleted.`,
          ``,
          `### Next step`,
          `Re-call \`infomaniak_delete_mailbox\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
        ].join("\n"),
      };
    }
    if (!consumeToken(input.confirmation_token, fingerprint)) {
      throw new Error("Confirmation token is invalid, expired, or doesn't match the parameters.");
    }
    const client = new PublicApiClient();
    await client.request<unknown>(
      "DELETE",
      `/1/mail_hostings/${input.mail_hosting_id}/mailboxes/${encodeURIComponent(input.mailbox_name)}`,
    );
    recordHistory({
      tool: "infomaniak_delete_mailbox",
      kind: "delete_site",
      summary: `Deleted mailbox ${input.mailbox_name} on mail_hosting ${input.mail_hosting_id}`,
      payload: {
        mail_hosting_id: input.mail_hosting_id,
        mailbox_name: input.mailbox_name,
      },
    });
    return {
      status: "applied" as const,
      mailbox_name: input.mailbox_name,
      message: `✅ Mailbox \`${input.mailbox_name}\` deleted.`,
    };
  },
});

// ---------------------------------------------------------------------------
// create_alias
// ---------------------------------------------------------------------------

const CreateAliasInput = z.object({
  mail_hosting_id: z.number().int().positive(),
  mailbox_name: z.string().min(1),
  /** New alias local part (without @domain). */
  alias: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9._-]+$/, "alias must be lowercase alphanumeric with . _ -"),
  confirmation_token: z.string().uuid().optional(),
});

const CreateAliasOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      mail_hosting_id: z.number(),
      mailbox_name: z.string(),
      alias: z.string(),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    alias: z.string(),
    message: z.string(),
  }),
]);

export const createAliasTool = defineTool({
  name: "infomaniak_create_mailbox_alias",
  description:
    "Add a new alias to an existing mailbox. Two-phase commit. The alias will receive emails delivered to the underlying mailbox.",
  inputSchema: CreateAliasInput,
  outputSchema: CreateAliasOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: async (input) => {
    const fingerprint = JSON.stringify({
      tool: "infomaniak_create_mailbox_alias",
      mail_hosting_id: input.mail_hosting_id,
      mailbox_name: input.mailbox_name,
      alias: input.alias,
    });
    if (!input.confirmation_token) {
      const { token, expiresAt } = mintToken(fingerprint);
      return {
        status: "plan" as const,
        plan: {
          mail_hosting_id: input.mail_hosting_id,
          mailbox_name: input.mailbox_name,
          alias: input.alias,
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — add alias`,
          ``,
          `- **Mailbox**: \`${input.mailbox_name}\``,
          `- **New alias**: \`${input.alias}\``,
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
      `/1/mail_hostings/${input.mail_hosting_id}/mailboxes/${encodeURIComponent(input.mailbox_name)}/aliases`,
      { body: { alias: input.alias } },
    );
    recordHistory({
      tool: "infomaniak_create_mailbox_alias",
      kind: "create_dns_record", // closest existing kind
      summary: `Added alias ${input.alias} to ${input.mailbox_name}`,
      payload: {
        mail_hosting_id: input.mail_hosting_id,
        mailbox_name: input.mailbox_name,
        alias: input.alias,
      },
    });
    return {
      status: "applied" as const,
      alias: input.alias,
      message: `✅ Alias \`${input.alias}\` added to mailbox \`${input.mailbox_name}\`.`,
    };
  },
});
