/**
 * Mail extras — read tools for signatures and backups (verified live).
 *
 * Endpoints:
 *   GET /1/mail_hostings/{id}/mailboxes/{name}/signatures
 *     → signatures, default_signature_id, default_reply_signature_id,
 *       position, verified_emails, valid_emails, is_forced, aliases
 *   GET /1/mail_hostings/{id}/mailboxes/{name}/backups
 *     → backups, state
 */
import { z } from "zod";

import { PublicApiClient } from "../api/http.js";

import { defineTool } from "./types.js";

// ---------------------------------------------------------------------------
// get_mailbox_signatures
// ---------------------------------------------------------------------------

const GetSigInput = z.object({
  mail_hosting_id: z.number().int().positive(),
  mailbox_name: z.string().min(1),
});

const GetSigOutput = z
  .object({
    mail_hosting_id: z.number(),
    mailbox_name: z.string(),
    signatures: z.array(z.unknown()),
    default_signature_id: z.number().nullable().optional(),
    default_reply_signature_id: z.number().nullable().optional(),
    is_forced: z.boolean().optional(),
    verified_emails: z.array(z.string()).optional(),
    valid_emails: z.array(z.string()).optional(),
    aliases: z.array(z.string()).optional(),
  })
  .passthrough();

export const getMailboxSignaturesTool = defineTool({
  name: "infomaniak_get_mailbox_signatures",
  description:
    "Get the email signatures configured on a specific mailbox (with default signature ids and verified-email metadata).",
  inputSchema: GetSigInput,
  outputSchema: GetSigOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input) => {
    const client = new PublicApiClient();
    const data = await client.request<Record<string, unknown>>(
      "GET",
      `/1/mail_hostings/${input.mail_hosting_id}/mailboxes/${encodeURIComponent(
        input.mailbox_name,
      )}/signatures`,
    );
    return {
      mail_hosting_id: input.mail_hosting_id,
      mailbox_name: input.mailbox_name,
      ...data,
    };
  },
});

// ---------------------------------------------------------------------------
// get_mailbox_backups
// ---------------------------------------------------------------------------

const GetBackupsInput = z.object({
  mail_hosting_id: z.number().int().positive(),
  mailbox_name: z.string().min(1),
});

const GetBackupsOutput = z
  .object({
    mail_hosting_id: z.number(),
    mailbox_name: z.string(),
    backups: z.array(z.unknown()),
    state: z.unknown().optional(),
  })
  .passthrough();

export const getMailboxBackupsTool = defineTool({
  name: "infomaniak_get_mailbox_backups",
  description:
    "List the available restore points for a mailbox (Infomaniak runs daily backups by default).",
  inputSchema: GetBackupsInput,
  outputSchema: GetBackupsOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input) => {
    const client = new PublicApiClient();
    const data = await client.request<Record<string, unknown>>(
      "GET",
      `/1/mail_hostings/${input.mail_hosting_id}/mailboxes/${encodeURIComponent(
        input.mailbox_name,
      )}/backups`,
    );
    return {
      mail_hosting_id: input.mail_hosting_id,
      mailbox_name: input.mailbox_name,
      ...data,
    };
  },
});
