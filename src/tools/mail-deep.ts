/**
 * Deep mail introspection — full mail_hosting + full mailbox details.
 *
 * Endpoints (manager-private):
 *   GET /proxy/1/mail_hostings/{id}?with=*                        — full hosting (43 keys)
 *   GET /proxy/1/mail_hostings/{id}/mailboxes/{name}?with=<list>  — full mailbox
 *   GET /proxy/1/mail_hostings/{id}?with=diagnostic_dns           — DNS health check
 *
 * IMPORTANT: We avoid `?with=*` on the mailbox endpoint — it triggers a
 * 500 server crash (Infomaniak bug, reported separately). We use an
 * explicit comma-separated combination of the 30+ valid values instead,
 * which works reliably.
 */
import { z } from "zod";

import { ManagerApiClient } from "../api/http.js";

import { defineTool } from "./types.js";

// ---------------------------------------------------------------------------
// get_mail_hosting_full
// ---------------------------------------------------------------------------

const MailHostingFullSchema = z.object({
  id: z.number(),
  account_id: z.number(),
  service_id: z.number(),
  service_name: z.string(),
  customer_name: z.string(),
  internal_name: z.string().nullable().optional(),
  created_at: z.number(),
  expired_at: z.number().nullable().optional(),
  has_maintenance: z.boolean().optional(),
  is_locked: z.boolean().optional(),
  has_operation_in_progress: z.boolean().optional(),
  tags: z.array(z.unknown()).optional(),
  unique_id: z.number().optional(),
  description: z.string().optional(),
  is_free: z.boolean().optional(),
  is_zero_price: z.boolean().optional(),
  is_trial: z.boolean().optional(),
  rights: z.record(z.boolean()).optional(),
  parent_id: z.number().nullable().optional(),
  parent_service_id: z.number().nullable().optional(),
  parent_service_name: z.string().nullable().optional(),
  /** Total mailboxes quota (number of slots). */
  total: z.number().optional(),
  /** Per-mailbox disk quota in bytes. */
  quota: z.number().optional(),
  /** Mailboxes currently in use. */
  used: z.number().optional(),
  /** Total redirections quota. */
  redirections_quota: z.number().optional(),
  redirections_target_quota: z.number().optional(),
  redirections_used: z.number().optional(),
  /** Admin user of the mail hosting. */
  admin: z
    .object({
      user_id: z.number(),
      email: z.string(),
      display_name: z.string(),
    })
    .optional(),
  /** FQDNs served by this mail hosting. */
  fqdn: z
    .array(
      z
        .object({
          id: z.number(),
          domain: z.string(),
        })
        .passthrough(),
    )
    .optional(),
  main_fqdn: z.string().optional(),
  main_fqdn_idn: z.string().optional(),
  main_fqdn_source: z.string().optional(),
  /** DNS health for the mail (MX, SPF, DKIM, DMARC). */
  diagnostic_dns: z
    .object({
      has_error: z.boolean(),
    })
    .passthrough()
    .optional(),
  dns_error: z.number().optional(),
  has_multi_password: z.boolean().optional(),
  has_new_creation_flow: z.boolean().optional(),
  has_team_access: z.boolean().optional(),
  signature_template_forced_state: z.unknown().optional(),
  mailing_lists_configuration: z.unknown().optional(),
  batch_action: z.unknown().optional(),
  status: z.unknown().optional(),
  bill_reference: z.string().nullable().optional(),
  bill_periodicity: z.number().optional(),
});

const GetMailHostingFullInput = z.object({
  mail_hosting_id: z
    .number()
    .int()
    .positive()
    .describe("Mail hosting id. Discover via infomaniak_list_mail_hostings."),
});

export const getMailHostingFullTool = defineTool({
  name: "infomaniak_get_mail_hosting_full",
  description:
    "Full mail hosting detail with diagnostic_dns (MX/SPF/DKIM/DMARC health check), quotas (mailboxes + redirections + per-mailbox disk), admin user, parent kSuite link, FQDN list, and team access flag. Use this for mail-config sanity checks. Manager-private.",
  inputSchema: GetMailHostingFullInput,
  outputSchema: MailHostingFullSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const client = new ManagerApiClient();
    return await client.request<z.infer<typeof MailHostingFullSchema>>(
      "GET",
      `/proxy/1/mail_hostings/${input.mail_hosting_id}`,
      { query: { "with[]": "*" } },
    );
  },
});

// ---------------------------------------------------------------------------
// get_mailbox_full
// ---------------------------------------------------------------------------

const AutoResponderSchema = z
  .object({
    is_active: z.boolean(),
    subject: z.string().optional(),
    body: z.string().optional(),
    start_date: z.number().nullable().optional(),
    end_date: z.number().nullable().optional(),
  })
  .passthrough();

const AliasShortSchema = z
  .object({
    alias: z.string().optional(),
    fqdn: z.string().optional(),
  })
  .passthrough();

const MailboxUserShortSchema = z.object({
  id: z.number(),
  display_name: z.string(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string(),
  avatar: z.string().optional(),
  is_sso: z.boolean().optional(),
});

const MailboxFullSchema = z.object({
  mailbox_name: z.string(),
  mailbox: z.string(),
  mailbox_idn: z.string().optional(),
  note: z.string().nullable().optional(),
  type: z.number().nullable().optional(),
  is_limited: z.boolean().optional(),
  is_free_mail: z.boolean().optional(),
  is_used_for_account: z.boolean().optional(),
  count_signatures: z.number().optional(),
  count_invitations: z.number().optional(),
  count_devices: z.number().optional(),
  has_auto_responder: z.boolean().optional(),
  auto_responder: AutoResponderSchema.optional(),
  has_redirection: z.boolean().optional(),
  redirection: z.array(z.unknown()).optional(),
  aliases: z.array(AliasShortSchema).optional(),
  full_aliases: z.array(z.unknown()).optional(),
  created_at: z.number().optional(),
  password_last_changed_at: z.number().nullable().optional(),
  size: z.number().optional().describe("Mailbox size on disk in bytes."),
  size_checked_at: z.number().nullable().optional(),
  imap_last_login_at: z.number().nullable().optional(),
  pop3_last_login_at: z.number().nullable().optional(),
  users: z.array(MailboxUserShortSchema).optional(),
  teams: z.array(z.unknown()).optional(),
  has_move_spam: z.boolean().optional(),
  authorized_senders: z.array(z.string()).optional(),
  blocked_senders: z.array(z.string()).optional(),
  has_dkim_signature: z.boolean().optional(),
  smtpban_bounce: z.unknown().optional(),
  smtpban_auth: z.unknown().optional(),
  smtpban_url: z.string().nullable().optional(),
  has_mail_filtering: z.boolean().optional(),
  mail_filtering_folder_commercials: z.unknown().optional(),
  mail_filtering_folder_social_networks: z.unknown().optional(),
  has_legacy_device: z.boolean().optional(),
  has_multi_password: z.boolean().optional(),
  external_mail_flag_enabled: z.boolean().optional(),
  count_users: z.number().optional(),
});

const GetMailboxFullInput = z.object({
  mail_hosting_id: z.number().int().positive(),
  mailbox_name: z
    .string()
    .describe("Local part of the mailbox (e.g. 'anthony' for anthony@coden.lu)."),
});

/**
 * Explicit list of `?with` values we ask for. We DO NOT use `?with=*` or
 * `?with=all` — both crash the server with HTTP 500 (Infomaniak bug,
 * reported). This explicit list covers all the useful fields validated
 * via 422-enumeration on 2026-05-31.
 */
const MAILBOX_WITH_FIELDS = [
  "full_name",
  "auto_responder",
  "redirection",
  "aliases",
  "full_aliases",
  "last_login",
  "password_last_changed_at",
  "users",
  "teams",
  "has_dkim_signature",
  "smtpban",
  "has_mail_filtering",
  "mail_filtering_folder_commercials",
  "mail_filtering_folder_social_networks",
  "size",
  "count_signatures",
  "count_invitations",
  "count_devices",
  "external_mail_flag_enabled",
  "has_legacy_device",
  "has_multi_password",
  "count_users",
  "authorized_senders",
  "blocked_senders",
  "has_move_spam",
].join(",");

export const getMailboxFullTool = defineTool({
  name: "infomaniak_get_mailbox_full",
  description:
    "Full mailbox detail: auto-responder (vacation reply) state + content, aliases, redirections, IMAP/POP3 last login, password age, size on disk, trusted devices count, DKIM signature flag, SMTP ban status, Gmail-style filtering (commercials/social_networks), authorized/blocked senders, attached users + teams. Useful for mailbox audits and onboarding flows. Manager-private.",
  inputSchema: GetMailboxFullInput,
  outputSchema: MailboxFullSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const client = new ManagerApiClient();
    return await client.request<z.infer<typeof MailboxFullSchema>>(
      "GET",
      `/proxy/1/mail_hostings/${input.mail_hosting_id}/mailboxes/${encodeURIComponent(input.mailbox_name)}`,
      { query: { "with[]": MAILBOX_WITH_FIELDS } },
    );
  },
});
