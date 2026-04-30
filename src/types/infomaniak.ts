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
