/**
 * `infomaniak_get_mailbox_info` — unified mailbox read (v0.10 consolidation).
 *
 * Single read tool that absorbs the prior get_mailbox_aliases /
 * get_mailbox_signatures / get_mailbox_backups trio. Caller picks which
 * sections to fetch via the `fields` argument; only the requested
 * endpoints are hit (in parallel). By default all three are fetched.
 *
 * Endpoints (each fetched only when its field is requested):
 *   GET /1/mail_hostings/{id}/mailboxes/{name}/aliases
 *   GET /1/mail_hostings/{id}/mailboxes/{name}/signatures
 *   GET /1/mail_hostings/{id}/mailboxes/{name}/backups
 *
 * Why consolidate: 3 sibling read tools on the same mailbox identifier
 * tax the agent's tool-selection budget. A single tool with an explicit
 * `fields` enum is more discoverable and lets the agent fetch just what
 * it needs in one call.
 */
import { z } from "zod";

import { PublicApiClient } from "../api/http.js";

import { defineTool } from "./types.js";

const FieldSchema = z.enum(["aliases", "signatures", "backups"]);

const GetMailboxInfoInput = z.object({
  mail_hosting_id: z
    .number()
    .int()
    .positive()
    .describe("Mail hosting ID. Discover via infomaniak_list_mail_hostings."),
  mailbox_name: z
    .string()
    .min(1)
    .describe(
      "Local part of the mailbox (the part before @, e.g. 'anthony' for anthony@example.com). NOT the full email address.",
    ),
  fields: z
    .array(FieldSchema)
    .nonempty()
    .default(["aliases", "signatures", "backups"])
    .describe("Sections to fetch. Each adds one API call. Omit to fetch all three."),
});

const AliasesSchema = z
  .object({
    enabled_alias: z.boolean().optional(),
    aliases: z.array(z.string()),
  })
  .passthrough();

const SignaturesSchema = z
  .object({
    signatures: z.array(z.unknown()),
    default_signature_id: z.number().nullable().optional(),
    default_reply_signature_id: z.number().nullable().optional(),
    is_forced: z.boolean().optional(),
    verified_emails: z.array(z.string()).optional(),
    valid_emails: z.array(z.string()).optional(),
    aliases: z.array(z.string()).optional(),
  })
  .passthrough();

const BackupsSchema = z
  .object({
    backups: z.array(z.unknown()),
    state: z.unknown().optional(),
  })
  .passthrough();

const GetMailboxInfoOutput = z.object({
  mail_hosting_id: z.number(),
  mailbox_name: z.string(),
  fields: z.array(FieldSchema),
  aliases: AliasesSchema.optional(),
  signatures: SignaturesSchema.optional(),
  backups: BackupsSchema.optional(),
  /** Per-section errors, when an individual section fetch failed. */
  errors: z.record(z.string()).optional(),
});

export const getMailboxInfoTool = defineTool({
  name: "infomaniak_get_mailbox_info",
  description:
    "Read mailbox metadata in one call. Pick any subset of {aliases, signatures, backups} via the `fields` argument; the tool hits only the corresponding endpoints in parallel. Replaces the v0.9 trio `get_mailbox_aliases` / `get_mailbox_signatures` / `get_mailbox_backups` with no loss of capability.",
  inputSchema: GetMailboxInfoInput,
  outputSchema: GetMailboxInfoOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input) => {
    const client = new PublicApiClient();
    const base = `/1/mail_hostings/${input.mail_hosting_id}/mailboxes/${encodeURIComponent(
      input.mailbox_name,
    )}`;
    const result: {
      mail_hosting_id: number;
      mailbox_name: string;
      fields: ReadonlyArray<z.infer<typeof FieldSchema>>;
      aliases?: z.infer<typeof AliasesSchema>;
      signatures?: z.infer<typeof SignaturesSchema>;
      backups?: z.infer<typeof BackupsSchema>;
      errors?: Record<string, string>;
    } = {
      mail_hosting_id: input.mail_hosting_id,
      mailbox_name: input.mailbox_name,
      fields: input.fields,
    };

    const errors: Record<string, string> = {};

    await Promise.all(
      input.fields.map(async (field) => {
        try {
          if (field === "aliases") {
            const data = await client.request<{
              enabled_alias?: number | boolean;
              aliases?: ReadonlyArray<unknown>;
            }>("GET", `${base}/aliases`);
            const aliasList = Array.isArray(data.aliases) ? data.aliases.map(String) : [];
            const enabledAlias =
              data.enabled_alias === undefined ? undefined : Boolean(data.enabled_alias);
            result.aliases = {
              ...(enabledAlias !== undefined ? { enabled_alias: enabledAlias } : {}),
              aliases: aliasList,
            };
          } else if (field === "signatures") {
            const data = await client.request<Record<string, unknown>>("GET", `${base}/signatures`);
            result.signatures = SignaturesSchema.parse(data);
          } else if (field === "backups") {
            const data = await client.request<Record<string, unknown>>("GET", `${base}/backups`);
            result.backups = BackupsSchema.parse(data);
          }
        } catch (err) {
          errors[field] = err instanceof Error ? err.message : String(err);
        }
      }),
    );

    if (Object.keys(errors).length > 0) {
      result.errors = errors;
    }
    return result;
  },
});
