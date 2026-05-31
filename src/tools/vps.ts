/**
 * VPS (Cloud Server, "cloud" service_id 25) introspection.
 *
 * Endpoints (manager-private):
 *   GET /proxy/1/vps?account_id={aid}      — list VPS on an account
 *   GET /proxy/1/vps/{id}?with=*           — full VPS detail (~65 keys)
 *
 * Each VPS is the Jelastic-managed Cloud Server product. The `?with=`
 * enumeration revealed 13 valid values:
 *   configuration | network | quota | pack | reinstall | rescue |
 *   status | vnc | state | firewall_applications | os_version | all | *
 */
import { z } from "zod";

import { ManagerApiClient } from "../api/http.js";

import { defineTool } from "./types.js";

// ---------------------------------------------------------------------------
// list_vps
// ---------------------------------------------------------------------------

const VpsListEntrySchema = z.object({
  id: z.number(),
  account_id: z.number(),
  service_id: z.number(),
  service_name: z.string(),
  customer_name: z.string(),
  internal_name: z.string().nullable().optional(),
  created_at: z.number(),
  expired_at: z.number().nullable().optional(),
  version: z.number().optional(),
  maintenance: z.boolean().optional(),
  locked: z.boolean().optional(),
  operation_in_progress: z.boolean().optional(),
  tags: z.array(z.unknown()).optional(),
  unique_id: z.number().optional(),
  description: z.string().nullable().optional(),
  is_free: z.boolean().optional(),
  is_zero_price: z.boolean().optional(),
  is_trial: z.boolean().optional(),
  rights: z.record(z.boolean()).optional(),
  location: z.string().optional().describe("Datacenter location (HTML-formatted in source)."),
  managed: z.boolean().optional(),
  lite: z.boolean().optional(),
  bill_periodicity: z.number().optional(),
  cloud_version: z.number().optional(),
  assistant: z.boolean().optional(),
  cloud: z.number().optional(),
});

const ListVpsInput = z.object({
  account_id: z
    .number()
    .int()
    .positive()
    .describe("Account id. Discover via infomaniak_list_organizations."),
});

const ListVpsOutput = z.object({
  account_id: z.number(),
  count: z.number(),
  vps: z.array(VpsListEntrySchema),
});

export const listVpsTool = defineTool({
  name: "infomaniak_list_vps",
  description:
    "List the VPS (Cloud Server, Jelastic-managed) products of an organization. Returns id, customer_name, internal_name (the server hostname), location, cloud_version, managed/lite flags, billing. Use this before `infomaniak_get_vps_full` to find the id of a specific server. Manager-private.",
  inputSchema: ListVpsInput,
  outputSchema: ListVpsOutput,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const client = new ManagerApiClient();
    const list = await client.request<z.infer<typeof VpsListEntrySchema>[]>("GET", "/proxy/1/vps", {
      query: { account_id: input.account_id },
    });
    return {
      account_id: input.account_id,
      count: list.length,
      vps: list,
    };
  },
});

// ---------------------------------------------------------------------------
// get_vps_full
// ---------------------------------------------------------------------------

const VpsFullSchema = z
  .object({
    id: z.number(),
    account_id: z.number(),
    service_id: z.number().optional(),
    service_name: z.string().optional(),
    customer_name: z.string(),
    internal_name: z.string().nullable().optional(),
    location: z.string().optional(),
    managed: z.boolean().optional(),
    lite: z.boolean().optional(),
    cloud: z.number().optional(),
    cloud_version: z.number().optional(),
    cpu: z.unknown().optional(),
    ram: z.unknown().optional(),
    perf: z.unknown().optional(),
    ip_v4: z.string().nullable().optional(),
    ip_v6: z.string().nullable().optional(),
    bandwidth: z.unknown().optional(),
    trafic: z.unknown().optional(),
    has_default_blocked_rdp: z.boolean().optional(),
    pack: z.unknown().optional(),
    is_renewable: z.boolean().optional(),
    mysql: z.unknown().optional(),
    mysql_version: z.string().nullable().optional(),
    database_type: z.string().nullable().optional(),
    database_upgrade: z.unknown().optional(),
    php_versions: z.unknown().optional(),
    can_migrate: z.boolean().optional(),
    os_version: z.string().nullable().optional(),
    can_migrate_db: z.boolean().optional(),
    total_website: z.number().optional(),
    used_website: z.number().optional(),
    total_dedicated_ip: z.number().optional(),
    used_dedicated_ip: z.number().optional(),
    total_hosting_web: z.number().optional(),
    used_hosting_web: z.number().optional(),
    total_disk_space: z.number().optional(),
    total_disk_space_assigned: z.number().optional(),
    total_disk_space_used: z.number().optional(),
    total_disk_database_used: z.number().optional(),
    firewall: z.unknown().optional(),
    /** Premium support contact info. */
    premium_support: z.boolean().optional(),
    premium_support_mail: z.string().nullable().optional(),
    premium_support_emergency: z.string().nullable().optional(),
    premium_support_url: z.string().nullable().optional(),
    /** Lifecycle. */
    expired_at: z.number().nullable().optional(),
    bill_periodicity: z.number().optional(),
    bill_reference: z.string().nullable().optional(),
    /** Migration history. */
    migration_start: z.number().nullable().optional(),
    migration_origin_id: z.string().nullable().optional(),
    migration_end: z.number().nullable().optional(),
  })
  .passthrough();

const GetVpsFullInput = z.object({
  vps_id: z.number().int().positive().describe("VPS id. Discover via infomaniak_list_vps."),
});

export const getVpsFullTool = defineTool({
  name: "infomaniak_get_vps_full",
  description:
    "Full VPS / Cloud Server detail: location (datacenter), managed/lite flags, IPv4 + IPv6, CPU/RAM/perf, bandwidth + traffic, disk usage (total/assigned/used/database), website/hosting counts, MySQL version + database type, PHP versions, firewall config, premium support contacts (email/url/emergency), migration history. Use after `infomaniak_list_vps` to drill into one server. Manager-private.",
  inputSchema: GetVpsFullInput,
  outputSchema: VpsFullSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const client = new ManagerApiClient();
    return await client.request<z.infer<typeof VpsFullSchema>>(
      "GET",
      `/proxy/1/vps/${input.vps_id}`,
      { query: { "with[]": "*" } },
    );
  },
});
