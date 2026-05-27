/**
 * `infomaniak_find_site` — domain-first site lookup.
 *
 * Resolves a public domain name to its location in the Infomaniak account
 * tree: which organization owns it, which web hosting it sits on, and
 * the site_id needed by every other site/cert/dns tool.
 *
 * Why this exists: `list_hostings` returns *hosting accounts* with
 * `customer_name` set to a free-form label (e.g. "Coden Privé"). A site
 * like example.com is only discoverable by iterating every hosting's
 * `list_sites`. An agent that starts from a domain name cannot reach it
 * without that scan — this tool encapsulates the scan and returns a
 * single answer.
 */
import { z } from "zod";

import { PublicApiClient } from "../api/http.js";
import { ProductSchema, SiteSchema } from "../types/infomaniak.js";
import { listAccountIds } from "../utils/accounts.js";

import { defineTool } from "./types.js";

const FindSiteInput = z.object({
  /** Public domain name to locate, e.g. "example.com" or "crm.example.com". */
  domain: z
    .string()
    .min(3)
    .describe(
      "Public domain to locate. Accepts root domains (example.com) or sub-domains (crm.example.com). Punycode (xn--...) is fine.",
    ),
  /** Optional: restrict the search to a single account. By default every account the token can see is scanned. */
  account_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Optional account_id to restrict the lookup. Omit to scan every account the token has access to.",
    ),
});

const FindSiteOutput = z.object({
  found: z.boolean(),
  domain: z.string(),
  account_id: z.number().optional(),
  hosting_id: z.number().optional(),
  hosting_label: z.string().optional(),
  site_id: z.number().optional(),
  site: SiteSchema.optional(),
  /** Number of hostings scanned to reach the answer (cost indicator). */
  scanned_hostings: z.number(),
  /** Notes / hints when not found. */
  hint: z.string().optional(),
});

export const findSiteTool = defineTool({
  name: "infomaniak_find_site",
  description:
    "Locate a domain (e.g. example.com) in the Infomaniak account tree. Returns {account_id, hosting_id, site_id, hosting_label, full site object}. Use this BEFORE any tool that requires hosting_id + site_id (get_certificate, request_certificate, list_databases, etc.) when you only know the domain name. Significantly cheaper than calling list_hostings + list_sites manually because it short-circuits on the first match.",
  inputSchema: FindSiteInput,
  outputSchema: FindSiteOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input) => {
    const client = new PublicApiClient();
    const target = input.domain.toLowerCase().trim();

    // Step 1: discover accounts to scan
    const accountIds: number[] = input.account_id ? [input.account_id] : await listAccountIds();

    let scanned = 0;

    // Step 2: for each account, list its hostings + each hosting's sites
    for (const aid of accountIds) {
      const products = await client.request<Array<unknown>>("GET", "/1/products", {
        query: { per_page: 500, account_id: aid },
      });
      const hostings = products
        .map((p) => {
          try {
            return ProductSchema.parse(p);
          } catch {
            return null;
          }
        })
        // Infomaniak returns service_name "hosting" (not "web_hosting") for web hosting products
        .filter((p): p is NonNullable<typeof p> => !!p && p.service_name === "hosting");

      for (const hosting of hostings) {
        scanned += 1;
        let sites: Array<unknown>;
        try {
          sites = await client.request<Array<unknown>>(
            "GET",
            `/1/web_hostings/${hosting.id}/sites`,
            { query: { "with[]": "applications", page: 1, per_page: 100 } },
          );
        } catch {
          continue;
        }
        for (const raw of sites) {
          let site;
          try {
            site = SiteSchema.parse(raw);
          } catch {
            continue;
          }
          const fqdn = (site.main_fqdn ?? "").toLowerCase();
          const cust = (site.customer_name ?? "").toLowerCase();
          if (
            fqdn === target ||
            cust === target ||
            fqdn === target.replace(/^www\./, "") ||
            cust === target.replace(/^www\./, "")
          ) {
            return {
              found: true,
              domain: input.domain,
              account_id: aid,
              hosting_id: hosting.id,
              hosting_label: hosting.customer_name,
              site_id: site.id,
              site,
              scanned_hostings: scanned,
            };
          }
        }
      }
    }

    return {
      found: false,
      domain: input.domain,
      scanned_hostings: scanned,
      hint: "Domain not found in any reachable account. Possible causes: (1) domain is registered but no site is provisioned, (2) the API token does not have access to the account that owns it, (3) the domain is on a different provider. Try `infomaniak_get_domain` to check if it's at least a registered domain.",
    };
  },
});
