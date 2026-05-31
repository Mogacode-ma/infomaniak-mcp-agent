/**
 * Deep domain detail tool.
 *
 * Endpoint (manager-private):
 *   GET /proxy/1/domain/{id_or_name}?with=*   — full domain detail
 *
 * Note: the manager exposes domain detail under `/proxy/1/domain/` (SINGULAR)
 * — `/proxy/1/domains/{id}` (plural) returns 404 nginx. This is a naming
 * inconsistency vs other resources (mail_hostings, web_hostings, accounts).
 * Documented in REVERSE-ENGINEERING.md.
 *
 * The endpoint accepts either the numeric domain_id OR the FQDN
 * (e.g. `agensea.net`) as the path segment — convenient when you have
 * the domain name but not the id.
 *
 * 25 `?with=` values are valid: auth_code, restorable, synonym, product,
 * error, domain_status, status, owner, dns, associated_products, users,
 * synonyms, glue_records, registry, tld, extra_fields, trade_status,
 * transfer_status, termination, service, options, rights, diagnostic_dns,
 * dns_logs_api_url, has_infomaniak_dns, use_custom_url, has_mail,
 * authcode_quota, subdomain_associated_products.
 */
import { z } from "zod";

import { ManagerApiClient } from "../api/http.js";

import { defineTool } from "./types.js";

const DomainFullSchema = z
  .object({
    id: z.number(),
    customer_name: z.string(),
    puny_code: z.string().optional(),
    has_dnssec: z.boolean().optional(),
    has_error: z.boolean().optional(),
    has_trustee_contact: z.boolean().optional(),
    has_whois_antispam: z.boolean().optional(),
    info: z.unknown().nullable().optional(),
    is_city_domain: z.boolean().optional(),
    is_dns_managed_by_infomaniak: z.boolean().optional(),
    is_dnssec_pending: z.boolean().optional(),
    is_external: z.boolean().optional(),
    is_idn: z.boolean().optional(),
    is_part_of_ksuite: z.boolean().optional(),
    is_premium: z.boolean().optional(),
    is_service_mail_domain_alias: z.boolean().optional(),
    is_service_mail_on_other_account: z.boolean().optional(),
    is_synonym: z.boolean().optional(),
    /** ?with=auth_code — the auth/EPP code needed to transfer the domain out. */
    auth_code: z.string().nullable().optional(),
    /** ?with=restorable — whether the domain is in a grace/restore period. */
    restorable: z.boolean().optional(),
    /** ?with=transfer_status — current transfer state. */
    transfer_status: z.unknown().optional(),
    /** ?with=trade_status — current trade (ownership change) state. */
    trade_status: z.unknown().optional(),
    /** ?with=termination — termination/expiry/deletion state. */
    termination: z.unknown().optional(),
    /** ?with=domain_status — overall domain lifecycle status. */
    domain_status: z.unknown().optional(),
    /** ?with=glue_records — glue records for the registry. */
    glue_records: z.unknown().optional(),
    /** ?with=tld — TLD detail (.com, .be, .swiss, etc.). */
    tld: z.unknown().optional(),
    /** ?with=registry — registry detail. */
    registry: z.unknown().optional(),
    /** ?with=owner — domain registrant. */
    owner: z.unknown().optional(),
    /** ?with=service — attached service (web hosting). */
    service: z.unknown().optional(),
    /** ?with=dns — DNS detail. */
    dns: z.unknown().optional(),
    /** ?with=associated_products — products attached to this domain. */
    associated_products: z.array(z.unknown()).optional(),
    subdomain_associated_products: z.array(z.unknown()).optional(),
    /** ?with=has_mail — whether the domain has a mail hosting attached. */
    has_mail: z.boolean().optional(),
    /** ?with=has_infomaniak_dns — DNS NS managed by Infomaniak. */
    has_infomaniak_dns: z.boolean().optional(),
    /** ?with=use_custom_url — uses a URL shortener (kSuite custom URL). */
    use_custom_url: z.boolean().optional(),
    /** ?with=diagnostic_dns — DNS health snapshot. */
    diagnostic_dns: z.unknown().optional(),
    /** ?with=dns_logs_api_url — URL to fetch DNS query logs. */
    dns_logs_api_url: z.string().nullable().optional(),
    /** ?with=authcode_quota — remaining quota for auth_code requests. */
    authcode_quota: z.unknown().optional(),
    /** ?with=extra_fields — registry-specific extra fields. */
    extra_fields: z.unknown().optional(),
    /** ?with=options — domain options. */
    options: z.unknown().optional(),
    /** ?with=rights — your rights on the domain. */
    rights: z.record(z.boolean()).optional(),
    /** ?with=error — any error state. */
    error: z.unknown().nullable().optional(),
    /** ?with=synonym / synonyms — alternative names. */
    synonym: z.unknown().optional(),
    synonyms: z.array(z.unknown()).optional(),
    /** ?with=users — users with access. */
    users: z.array(z.unknown()).optional(),
    /** ?with=status — generic status. */
    status: z.unknown().optional(),
    /** ?with=product — wrapped product detail. */
    product: z.unknown().optional(),
  })
  .passthrough();

const GetDomainFullInput = z.object({
  domain: z
    .string()
    .describe(
      "Either the numeric domain id (e.g. '1938345') OR the FQDN (e.g. 'agensea.net'). Both work. Discover via infomaniak_list_domains.",
    ),
});

export const getDomainFullTool = defineTool({
  name: "infomaniak_get_domain_full",
  description:
    "Full domain detail including auth_code (EPP transfer code), transfer_status, trade_status, termination state, glue records, TLD/registry info, attached service (web hosting), DNS detail, DNS health diagnostic, owner (registrant), associated products on the domain AND its subdomains, and the DNS logs API URL. Accepts either domain_id or FQDN. Manager-private.",
  inputSchema: GetDomainFullInput,
  outputSchema: DomainFullSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const client = new ManagerApiClient();
    return await client.request<z.infer<typeof DomainFullSchema>>(
      "GET",
      `/proxy/1/domain/${encodeURIComponent(input.domain)}`,
      { query: { "with[]": "*" } },
    );
  },
});
