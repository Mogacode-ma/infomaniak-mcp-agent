/**
 * Domain tools — read-only against documented endpoints.
 *
 * `infomaniak_list_domains` reuses `/1/products` filtered by service_name.
 * `infomaniak_get_domain` calls `/1/domain/{name}` (verified live: returns
 * is_dns_managed_by_infomaniak, has_dnssec, has_error, …).
 */
import { z } from "zod";

import { PublicApiClient } from "../api/http.js";
import { DomainSchema, ProductSchema } from "../types/infomaniak.js";

import { defineTool } from "./types.js";

// ---------------------------------------------------------------------------
// list_domains
// ---------------------------------------------------------------------------

const ListDomainsInput = z.object({
  account_id: z.number().int().positive(),
});

const ListDomainsOutput = z.object({
  account_id: z.number(),
  count: z.number(),
  domains: z.array(
    ProductSchema.pick({
      id: true,
      account_id: true,
      service_name: true,
      customer_name: true,
      created_at: true,
      expired_at: true,
    }),
  ),
});

export const listDomainsTool = defineTool({
  name: "infomaniak_list_domains",
  description:
    "List every domain owned by an Infomaniak organization, with creation and expiration dates.",
  inputSchema: ListDomainsInput,
  outputSchema: ListDomainsOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input) => {
    const client = new PublicApiClient();
    const products = await client.request<Array<unknown>>("GET", "/1/products", {
      query: { per_page: 500, account_id: input.account_id },
    });
    const domains = products
      .map((p) => ProductSchema.parse(p))
      .filter((p) => p.account_id === input.account_id && p.service_name === "domain")
      .map(({ id, account_id, service_name, customer_name, created_at, expired_at }) => ({
        id,
        account_id,
        service_name,
        customer_name,
        ...(created_at !== undefined ? { created_at } : {}),
        ...(expired_at !== undefined ? { expired_at } : {}),
      }));
    return { account_id: input.account_id, count: domains.length, domains };
  },
});

// ---------------------------------------------------------------------------
// get_domain
// ---------------------------------------------------------------------------

const GetDomainInput = z.object({
  domain: z.string().min(3).describe("The domain name, e.g. 'example.com'"),
});

const GetDomainOutput = DomainSchema;

export const getDomainTool = defineTool({
  name: "infomaniak_get_domain",
  description:
    "Get detailed information about a domain (DNS management status, DNSSEC, IDN, errors).",
  inputSchema: GetDomainInput,
  outputSchema: GetDomainOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input) => {
    const client = new PublicApiClient();
    const data = await client.request<unknown>(
      "GET",
      `/1/domain/${encodeURIComponent(input.domain)}`,
    );
    return DomainSchema.parse(data);
  },
});
