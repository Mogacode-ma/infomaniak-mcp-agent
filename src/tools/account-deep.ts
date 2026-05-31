/**
 * Deep account introspection — full account detail, teams, tags.
 *
 * Endpoints (manager-private):
 *   GET /proxy/1/accounts/{id}?with=*           — full account (addresses, billing, support, 2FA req, logo)
 *   GET /proxy/1/accounts/{id}/teams?with=*     — teams with owners, user/product counts
 *   GET /proxy/1/accounts/{id}/teams/{tid}      — single team detail
 *   GET /proxy/1/accounts/{id}/teams/{tid}/users — team members
 *   GET /proxy/1/accounts/{id}/tags?with=*      — tags + products carrying each tag
 *
 * Complements the existing `infomaniak_list_organizations` (which is the
 * public Bearer API summary). These tools surface the manager-private
 * details that drive the org panel.
 */
import { z } from "zod";

import { ManagerApiClient } from "../api/http.js";

import { defineTool } from "./types.js";

// ---------------------------------------------------------------------------
// get_account_full
// ---------------------------------------------------------------------------

const AddressSchema = z.object({
  id: z.number(),
  street: z.string(),
  street2: z.string().optional(),
  zip: z.string(),
  city: z.string(),
  type: z.string().optional(),
  country: z
    .object({
      id: z.number(),
      name: z.string(),
      short_name: z.string(),
    })
    .optional(),
  for_invoice: z.boolean().optional(),
});

const AccountFullSchema = z.object({
  id: z.number(),
  name: z.string(),
  legal_entity_type: z.string().optional(),
  website: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  vat_number: z.string().optional(),
  locale: z.string().optional(),
  timezone: z.string().optional(),
  logo: z.string().nullable().optional(),
  logo_square: z.string().nullable().optional(),
  /** Internal support tier (0 = none, 1 = standard, 2 = premium). */
  support_level: z.number().optional(),
  /** Whether this organization enforces 2FA on every member. */
  has_2fa_required: z.boolean().optional(),
  beta: z.boolean().optional(),
  type: z.string().optional().describe('"owner" | "admin" | "billing" | "user" — your role.'),
  billing: z.boolean().optional(),
  mailing: z.boolean().optional(),
  workspace_only: z.boolean().optional(),
  no_access: z.boolean().optional(),
  is_blocked: z.boolean().optional(),
  is_customer: z.boolean().optional(),
  is_sso: z.boolean().optional(),
  nb_users: z.number().optional(),
  count_owners: z.number().optional(),
  has_customer_paiement_method: z.boolean().optional(),
  addresses: z.array(AddressSchema).optional(),
  tags: z
    .array(
      z.object({
        id: z.number(),
        name: z.string(),
        color: z.number(),
      }),
    )
    .optional(),
  created_at: z.number().optional(),
});

const GetAccountFullInput = z.object({
  account_id: z
    .number()
    .int()
    .positive()
    .describe("Account/organization id. Discover via infomaniak_list_organizations."),
});

export const getAccountFullTool = defineTool({
  name: "infomaniak_get_account_full",
  description:
    "Full organization detail: legal entity, billing address(es), VAT, locale, timezone, logo URLs, support tier (premium=2), 2FA-required policy, your role (owner/admin/billing/user), user/owner counts, tags. Manager-private.",
  inputSchema: GetAccountFullInput,
  outputSchema: AccountFullSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const client = new ManagerApiClient();
    return await client.request<z.infer<typeof AccountFullSchema>>(
      "GET",
      `/proxy/1/accounts/${input.account_id}`,
      { query: { "with[]": "*" } },
    );
  },
});

// ---------------------------------------------------------------------------
// list_teams_and_tags
// ---------------------------------------------------------------------------

const TeamSchema = z.object({
  id: z.number(),
  name: z.string(),
  color_id: z.number().optional(),
  owned_by_id: z.number().optional(),
  created_by_id: z.number().optional(),
  created_at: z.number().optional(),
  updated_at: z.number().optional(),
  description: z.string().nullable().optional(),
  parent_id: z.number().nullable().optional(),
  logo: z.string().nullable().optional(),
  position: z.number().optional(),
  user_count: z.number().optional(),
  product_count: z.number().optional(),
  owners: z
    .array(
      z.object({
        id: z.number(),
        display_name: z.string(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        email: z.string(),
        avatar: z.string().optional(),
        is_sso: z.boolean().optional(),
      }),
    )
    .optional(),
  is_sso: z.boolean().optional(),
});

const TagWithProductsSchema = z.object({
  id: z.number(),
  name: z.string(),
  color: z.number(),
  products: z
    .array(
      z.object({
        item_id: z.number(),
        service_id: z.number(),
        name: z.string(),
      }),
    )
    .optional(),
});

const ListTeamsAndTagsInput = z.object({
  account_id: z.number().int().positive(),
});

const ListTeamsAndTagsOutput = z.object({
  teams: z.array(TeamSchema),
  teams_count: z.number(),
  tags: z.array(TagWithProductsSchema),
  tags_count: z.number(),
});

export const listTeamsAndTagsTool = defineTool({
  name: "infomaniak_list_teams_and_tags",
  description:
    "List the teams (with owners + user/product counts) AND the tags (with products carrying each tag) of an organization, in a single call. Both are useful to understand how an org partitions access and labels its products. Manager-private.",
  inputSchema: ListTeamsAndTagsInput,
  outputSchema: ListTeamsAndTagsOutput,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const client = new ManagerApiClient();
    const [teams, tags] = await Promise.all([
      client.request<z.infer<typeof TeamSchema>[]>(
        "GET",
        `/proxy/1/accounts/${input.account_id}/teams`,
        { query: { "with[]": "*" } },
      ),
      client.request<z.infer<typeof TagWithProductsSchema>[]>(
        "GET",
        `/proxy/1/accounts/${input.account_id}/tags`,
        { query: { "with[]": "*" } },
      ),
    ]);
    return {
      teams,
      teams_count: teams.length,
      tags,
      tags_count: tags.length,
    };
  },
});
