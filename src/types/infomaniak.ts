/**
 * Zod schemas for Infomaniak API resources.
 *
 * Used for both runtime validation (defensive) and type inference.
 * Schemas are lenient: unknown fields are passed through unchanged so
 * we don't break when Infomaniak adds new fields.
 */
import { z } from "zod";

// ----------------------------------------------------------------------------
// Account / organization
// ----------------------------------------------------------------------------

export const AccountSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.string().optional(),
  legal_entity_type: z.string().nullable().optional(),
  support_level: z.number().optional(),
  website: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
});
export type Account = z.infer<typeof AccountSchema>;

// ----------------------------------------------------------------------------
// Product (umbrella for hostings, mail_hostings, domains, drives, etc.)
// ----------------------------------------------------------------------------

export const ProductSchema = z.object({
  id: z.number(),
  account_id: z.number(),
  service_id: z.number(),
  service_name: z.string(),
  customer_name: z.string().nullable(),
  internal_name: z.string().nullable().optional(),
  created_at: z.number().optional(),
  expired_at: z.number().nullable().optional(),
  has_maintenance: z.boolean().optional(),
  is_locked: z.boolean().optional(),
  has_operation_in_progress: z.boolean().optional(),
  unique_id: z.number().optional(),
  parent_id: z.number().optional(),
  parent_service_name: z.string().optional(),
});
export type Product = z.infer<typeof ProductSchema>;

// ----------------------------------------------------------------------------
// Web hosting + sites
// ----------------------------------------------------------------------------

export const WebHostingSchema = z.object({
  web_hosting_id: z.number().optional(),
  id: z.number().optional(),
  account_id: z.number(),
  service_id: z.number(),
  service_name: z.string(),
  customer_name: z.string().nullable(),
  has_maintenance: z.boolean().optional(),
  is_locked: z.boolean().optional(),
  has_operation_in_progress: z.boolean().optional(),
  prefix: z.string().optional(),
  ips_identifier: z.string().optional(),
  hosting_root_path: z.string().optional(),
});
export type WebHosting = z.infer<typeof WebHostingSchema>;

export const SiteSchema = z.object({
  id: z.number(),
  account_id: z.number(),
  customer_name: z.string(),
  hosting_type: z.string().optional(),
  main_fqdn: z.string().nullable().optional(),
  directory: z.string().optional(),
  ssl_status: z.string().optional(),
  ssl_issuer: z.string().nullable().optional(),
  has_wordpress: z.boolean().optional(),
  has_website_builder: z.boolean().optional(),
  applications: z
    .array(
      z.object({
        id: z.number(),
        type: z.string(),
        version: z.string().optional(),
        name: z.string().optional(),
        url: z.string().optional(),
        link_admin: z.string().optional(),
        is_complete: z.boolean().optional(),
      }),
    )
    .optional(),
  parent_id: z.number().optional(),
  parent_hosting_name: z.string().optional(),
});
export type Site = z.infer<typeof SiteSchema>;

// ----------------------------------------------------------------------------
// Site creation request
// ----------------------------------------------------------------------------

/**
 * Payload for POST /proxy/1/web_hostings/{id}/sites.
 *
 * Hard-won knowledge — see REVERSE-ENGINEERING.md.
 * Without `force_fqdn:true` and `directory` prefixed by "/sites/", the
 * server returns success with a progress_id but does NOT actually create
 * the site (silent no-op).
 */
export const CreateSitePayloadSchema = z.object({
  /** Public FQDN — e.g. "blog.example.com". */
  fqdn: z
    .string()
    .min(1)
    .regex(/^[a-z0-9.-]+$/i, "FQDN must be lowercase alphanumeric with dashes/dots"),
  /** Filesystem path on the hosting — must start with "/sites/". */
  directory: z.string().regex(/^\/sites\/[\w.-]+$/, "directory must look like /sites/<name>"),
  /** Server-side flag — REQUIRED, must be true. */
  force_fqdn: z.literal(true).default(true),
  /** Apache/PHP environment. nodejs hostings use a different value. */
  environment: z.enum(["apache_php", "nodejs"]).default("apache_php"),
});
export type CreateSitePayload = z.infer<typeof CreateSitePayloadSchema>;

/** Response from a successful site creation — async via progress_id. */
export const CreateSiteResponseSchema = z.object({
  progress_id: z.string(),
});
export type CreateSiteResponse = z.infer<typeof CreateSiteResponseSchema>;

// ----------------------------------------------------------------------------
// Domain
// ----------------------------------------------------------------------------

export const DomainSchema = z.object({
  id: z.number().optional(),
  customer_name: z.string(),
  is_dns_managed_by_infomaniak: z.boolean().optional(),
  is_external: z.boolean().optional(),
  has_dnssec: z.boolean().optional(),
  is_dnssec_pending: z.boolean().optional(),
  has_error: z.boolean().optional(),
  has_trustee_contact: z.boolean().optional(),
  has_whois_antispam: z.boolean().optional(),
  is_part_of_ksuite: z.boolean().optional(),
  is_premium: z.boolean().optional(),
  is_idn: z.boolean().optional(),
  puny_code: z.string().nullable().optional(),
});
export type Domain = z.infer<typeof DomainSchema>;

// ----------------------------------------------------------------------------
// DNS records
// ----------------------------------------------------------------------------

/** DNS record types supported by Infomaniak. */
export const DnsRecordTypeSchema = z.enum([
  "A",
  "AAAA",
  "CNAME",
  "MX",
  "TXT",
  "SRV",
  "NS",
  "CAA",
  "PTR",
  "SPF",
]);
export type DnsRecordType = z.infer<typeof DnsRecordTypeSchema>;

/**
 * DNS record as returned by `GET /2/zones/{zone}/records`.
 *
 * Observed live on a real Infomaniak zone (96 records, types
 * A/AAAA/CNAME/MX/NS/TXT). Only these keys are ever present:
 * `id`, `source`, `type`, `ttl`, `target`, `updated_at`.
 *
 * Notes about Infomaniak's serialization:
 * - `source` is `"."` for the zone apex, otherwise the subdomain part
 *   (e.g. `"www"`).
 * - `target` for MX/SRV records embeds the priority inline, e.g.
 *   `"5 mta-gw.infomaniak.ch"`. There is no separate `priority` field.
 */
export const DnsRecordSchema = z.object({
  id: z.number().optional(),
  source: z.string(),
  type: DnsRecordTypeSchema,
  ttl: z.number().int().nonnegative(),
  target: z.string(),
  updated_at: z.number().optional(),
});
export type DnsRecord = z.infer<typeof DnsRecordSchema>;

// ----------------------------------------------------------------------------
// Mail hosting
// ----------------------------------------------------------------------------

export const MailHostingSchema = z.object({
  id: z.number(),
  account_id: z.number(),
  service_name: z.string(),
  customer_name: z.string(),
  main_fqdn: z.string().optional(),
  is_part_of_ksuite: z.boolean().optional(),
  has_maintenance: z.boolean().optional(),
  is_locked: z.boolean().optional(),
  has_operation_in_progress: z.boolean().optional(),
});
export type MailHosting = z.infer<typeof MailHostingSchema>;

export const MailboxSchema = z.object({
  mailbox_name: z.string(),
  mailbox: z.string().optional(),
  mailbox_idn: z.string().optional(),
  note: z.string().nullable().optional(),
  /** Mailbox kind as returned by the API. Observed numeric (1, 2, …) and null in production — historically documented as string. Accept all three for forward-compat. */
  type: z.union([z.string(), z.number()]).nullable().optional(),
  is_limited: z.boolean().optional(),
  is_free_mail: z.boolean().optional(),
  is_used_for_account: z.boolean().optional(),
});
export type Mailbox = z.infer<typeof MailboxSchema>;
