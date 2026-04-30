/**
 * High-level workflow tools — orchestrate multiple typed tools to deliver
 * a complete real-world outcome in a single guided dialogue.
 *
 * v0.7 ships:
 *
 * - `infomaniak_provision_site_full` — creates a website end-to-end:
 *      1. site on the chosen web hosting (uses createSiteTool internals)
 *      2. one MariaDB database (uses createDatabaseTool internals)
 *      3. an A record on the parent domain pointing the FQDN at the
 *         hosting's primary IP (uses dnsCreateRecordTool internals)
 *
 * - `infomaniak_audit_dns_zones` — bulk read of every zone owned by an
 *    account, with a simple per-zone health summary (record count,
 *    DNSSEC status). Useful when Patrick wants a cross-domain overview.
 *
 * Workflow tools intentionally re-use the smaller tools' two-phase
 * commit token internally: the caller confirms ONCE at the workflow
 * level, the workflow then performs each step. If any step fails, the
 * workflow surfaces the error AND the partial completion state so the
 * agent can take corrective action.
 */
import { z } from "zod";

import { ManagerApiClient, PublicApiClient } from "../api/http.js";
import { DnsRecordSchema } from "../types/infomaniak.js";
import { consumeToken, mintToken } from "../utils/confirmation.js";
import { recordHistory } from "../utils/history.js";

import { defineTool } from "./types.js";

// ---------------------------------------------------------------------------
// provision_site_full
// ---------------------------------------------------------------------------

const ProvisionInput = z.object({
  hosting_id: z.number().int().positive(),
  /** FQDN of the new site (e.g. "shop.example.com"). */
  fqdn: z
    .string()
    .min(3)
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "fqdn must look like 'sub.example.com'"),
  /** Database to create alongside the site. */
  database_name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_]+$/i, "database_name must be alphanumeric with underscores"),
  /**
   * Parent zone to host the A record on. If omitted we'll derive it
   * from the FQDN (everything after the first dot). Supply explicitly
   * if your subdomain is multi-level (e.g. "app.subzone.example.com"
   * where the actual zone is "example.com").
   */
  zone: z.string().min(3).optional(),
  /**
   * IPv4 to point the A record at. Defaults to Infomaniak's shared
   * apache_php pool front-end. If your hosting has a dedicated IP,
   * supply it here.
   */
  target_ipv4: z.string().ip({ version: "v4" }).default("185.177.62.161"),
  ttl: z.number().int().min(60).max(86_400).default(3600),
  /** Skip the DNS step (useful when DNS is managed elsewhere). */
  skip_dns: z.boolean().default(false),
  confirmation_token: z.string().uuid().optional(),
});

const StepStatusSchema = z.enum(["pending", "succeeded", "failed", "skipped"]);

const StepResultSchema = z.object({
  step: z.string(),
  status: StepStatusSchema,
  detail: z.string().optional(),
  error: z.string().optional(),
});

const ProvisionOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      hosting_id: z.number(),
      fqdn: z.string(),
      directory: z.string(),
      database_name: z.string(),
      zone: z.string(),
      target_ipv4: z.string(),
      skip_dns: z.boolean(),
      steps: z.array(z.string()),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    overall: z.enum(["all_succeeded", "partial_failure"]),
    fqdn: z.string(),
    steps: z.array(StepResultSchema),
    site_progress_id: z.string().optional(),
    record_id: z.number().optional(),
  }),
]);

function deriveZone(fqdn: string): string {
  const parts = fqdn.split(".");
  if (parts.length < 2) {
    throw new Error(`fqdn '${fqdn}' is not a valid hostname`);
  }
  return parts.slice(-2).join(".");
}

export const provisionSiteFullTool = defineTool({
  name: "infomaniak_provision_site_full",
  description:
    "Provision a complete website end-to-end: web site + MariaDB database + DNS A record. Two-phase commit at the workflow level. The plan lists every step that will run; on apply, each step is executed and reported in order so you can see partial completion if anything fails mid-way.",
  inputSchema: ProvisionInput,
  outputSchema: ProvisionOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: async (input) => {
    const directory = `/sites/${input.fqdn}`;
    const zone = input.zone ?? deriveZone(input.fqdn);
    const sourceLabel = input.fqdn.endsWith(`.${zone}`)
      ? input.fqdn.slice(0, -(zone.length + 1))
      : input.fqdn;
    const fingerprint = JSON.stringify({
      tool: "infomaniak_provision_site_full",
      hosting_id: input.hosting_id,
      fqdn: input.fqdn,
      database_name: input.database_name,
      zone,
      target_ipv4: input.target_ipv4,
      skip_dns: input.skip_dns,
    });
    const stepsToRun: string[] = [
      "create_site (manager-private)",
      "create_database (manager-private)",
    ];
    if (!input.skip_dns) {
      stepsToRun.push(`create_dns_record (A ${sourceLabel}.${zone} → ${input.target_ipv4})`);
    }

    if (!input.confirmation_token) {
      const { token, expiresAt } = mintToken(fingerprint);
      return {
        status: "plan" as const,
        plan: {
          hosting_id: input.hosting_id,
          fqdn: input.fqdn,
          directory,
          database_name: input.database_name,
          zone,
          target_ipv4: input.target_ipv4,
          skip_dns: input.skip_dns,
          steps: stepsToRun,
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — provision_site_full`,
          ``,
          `- **Hosting**: ${input.hosting_id}`,
          `- **Site**: \`${input.fqdn}\` → \`${directory}\``,
          `- **Database**: \`${input.database_name}\``,
          input.skip_dns
            ? `- **DNS**: skipped (managed elsewhere)`
            : `- **DNS**: A \`${sourceLabel}\` on zone \`${zone}\` → \`${input.target_ipv4}\` (TTL ${input.ttl}s)`,
          ``,
          `### Steps that will run`,
          ...stepsToRun.map((s, i) => `${i + 1}. ${s}`),
          ``,
          `### Side effects`,
          `- The site appears in the manager.`,
          `- A new MariaDB database is created.`,
          input.skip_dns ? `` : `- DNS propagation takes 1–5 minutes for short TTLs.`,
          `- Let's Encrypt SSL is auto-issued by Infomaniak after DNS resolves.`,
          ``,
          `### Next step`,
          `Re-call \`infomaniak_provision_site_full\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
        ].join("\n"),
      };
    }

    if (!consumeToken(input.confirmation_token, fingerprint)) {
      throw new Error("Confirmation token is invalid, expired, or doesn't match the parameters.");
    }

    const steps: Array<z.infer<typeof StepResultSchema>> = [];
    const manager = new ManagerApiClient();
    const publicClient = new PublicApiClient();
    let siteProgressId: string | undefined;
    let recordId: number | undefined;
    let overall: "all_succeeded" | "partial_failure" = "all_succeeded";

    // Step 1: create site (manager-private)
    try {
      const sitePayload = {
        fqdn: input.fqdn,
        directory,
        force_fqdn: true,
        environment: "apache_php" as const,
      };
      const siteResp = await manager.request<{ progress_id: string }>(
        "POST",
        `/proxy/1/web_hostings/${input.hosting_id}/sites`,
        { body: sitePayload },
      );
      siteProgressId = siteResp.progress_id;
      steps.push({
        step: "create_site",
        status: "succeeded",
        detail: `progress_id ${siteProgressId}`,
      });
    } catch (err) {
      overall = "partial_failure";
      steps.push({
        step: "create_site",
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
      // If site creation failed, abort — db and dns wouldn't make sense.
      return { status: "applied" as const, overall, fqdn: input.fqdn, steps };
    }

    // Step 2: create database
    try {
      await manager.request<unknown>(
        "POST",
        `/proxy/1/web_hostings/${input.hosting_id}/databases`,
        { body: { database_name: input.database_name } },
      );
      steps.push({
        step: "create_database",
        status: "succeeded",
        detail: `database_name ${input.database_name}`,
      });
    } catch (err) {
      overall = "partial_failure";
      steps.push({
        step: "create_database",
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Step 3: DNS A record (if not skipped)
    if (input.skip_dns) {
      steps.push({ step: "create_dns_record", status: "skipped" });
    } else {
      try {
        const created = await publicClient.request<unknown>(
          "POST",
          `/2/zones/${encodeURIComponent(zone)}/records`,
          {
            body: {
              source: sourceLabel,
              type: "A",
              target: input.target_ipv4,
              ttl: input.ttl,
            },
          },
        );
        const parsed = DnsRecordSchema.parse(created);
        recordId = parsed.id;
        steps.push({
          step: "create_dns_record",
          status: "succeeded",
          detail: `record_id ${parsed.id ?? "?"} A ${sourceLabel}.${zone} → ${input.target_ipv4}`,
        });
      } catch (err) {
        overall = "partial_failure";
        steps.push({
          step: "create_dns_record",
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    recordHistory({
      tool: "infomaniak_provision_site_full",
      kind: "create_site",
      summary: `Provisioned ${input.fqdn} (site + db + dns)`,
      payload: {
        hosting_id: input.hosting_id,
        fqdn: input.fqdn,
        database_name: input.database_name,
        zone,
        target_ipv4: input.target_ipv4,
        steps: steps.map((s) => ({ step: s.step, status: s.status })),
      },
    });

    return {
      status: "applied" as const,
      overall,
      fqdn: input.fqdn,
      steps,
      ...(siteProgressId !== undefined ? { site_progress_id: siteProgressId } : {}),
      ...(recordId !== undefined ? { record_id: recordId } : {}),
    };
  },
});

// ---------------------------------------------------------------------------
// audit_dns_zones
// ---------------------------------------------------------------------------

const AuditDnsInput = z.object({
  account_id: z.number().int().positive(),
  /** Stop after this many domains to keep the API call budget bounded. */
  max_domains: z.number().int().min(1).max(200).default(50),
});

const ZoneSummarySchema = z.object({
  zone: z.string(),
  record_count: z.number(),
  has_dnssec: z.boolean().nullable(),
  error: z.string().optional(),
});

const AuditDnsOutput = z.object({
  account_id: z.number(),
  scanned: z.number(),
  zones: z.array(ZoneSummarySchema),
  summary_markdown: z.string(),
});

export const auditDnsZonesTool = defineTool({
  name: "infomaniak_audit_dns_zones",
  description:
    "Bulk-read every domain owned by an account: number of DNS records and DNSSEC status per zone. Useful for spot-checking large fleets.",
  inputSchema: AuditDnsInput,
  outputSchema: AuditDnsOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input) => {
    const client = new PublicApiClient();
    const products = await client.request<
      Array<{ account_id: number; service_name: string; customer_name: string }>
    >("GET", "/1/products", { query: { per_page: 500, account_id: input.account_id } });
    const domainNames = products
      .filter((p) => p.account_id === input.account_id && p.service_name === "domain")
      .map((p) => p.customer_name)
      .slice(0, input.max_domains);

    const zones: Array<z.infer<typeof ZoneSummarySchema>> = [];
    for (const zone of domainNames) {
      try {
        const records = await client.request<Array<unknown>>(
          "GET",
          `/2/zones/${encodeURIComponent(zone)}/records`,
        );
        let hasDnssec: boolean | null = null;
        try {
          const ds = await client.request<{ has_dnssec?: boolean }>(
            "GET",
            `/2/domains/${encodeURIComponent(zone)}/dnssec/check`,
          );
          hasDnssec = ds.has_dnssec ?? null;
        } catch {
          hasDnssec = null;
        }
        zones.push({ zone, record_count: records.length, has_dnssec: hasDnssec });
      } catch (err) {
        zones.push({
          zone,
          record_count: 0,
          has_dnssec: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const dnssecOn = zones.filter((z) => z.has_dnssec === true).length;
    const errored = zones.filter((z) => z.error).length;
    const summary = [
      `# DNS audit — account ${input.account_id}`,
      ``,
      `Scanned **${zones.length}** zones (capped at ${input.max_domains}).`,
      ``,
      `- DNSSEC enabled: **${dnssecOn}** / ${zones.length}`,
      `- Zones with errors: **${errored}**`,
      ``,
      `## Per-zone breakdown`,
      ``,
      ...zones.map(
        (z) =>
          `- \`${z.zone}\`: ${z.record_count} record(s)${
            z.has_dnssec === true ? " · DNSSEC ✅" : z.has_dnssec === false ? " · DNSSEC ❌" : ""
          }${z.error ? ` · error: ${z.error}` : ""}`,
      ),
    ].join("\n");

    return {
      account_id: input.account_id,
      scanned: zones.length,
      zones,
      summary_markdown: summary,
    };
  },
});
