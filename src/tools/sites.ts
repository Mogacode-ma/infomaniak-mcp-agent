/**
 * Site management tools — list + create.
 *
 * `infomaniak_list_sites` is read-only and uses the public Bearer API.
 *
 * `infomaniak_create_site` is destructive. It uses the manager-private
 * API (SASESSION + CSRF) because the public API silently no-ops POSTs to
 * /1/web_hostings/{id}/sites — see REVERSE-ENGINEERING.md. It implements
 * the agentic two-phase commit:
 *
 *   1st call (no `confirmation_token`): validates input, returns plan +
 *      single-use token valid for ~60 seconds.
 *   2nd call (with valid `confirmation_token`): executes the creation.
 */
import { z } from "zod";

import { ManagerApiClient, PublicApiClient } from "../api/http.js";
import { SiteSchema } from "../types/infomaniak.js";
import { consumeToken, mintToken } from "../utils/confirmation.js";
import { recordHistory } from "../utils/history.js";
import { childLogger } from "../utils/logger.js";

import { defineTool } from "./types.js";

const log = childLogger({ module: "tools/sites" });

// --- list_sites ------------------------------------------------------------

const ListInputSchema = z.object({
  hosting_id: z.number().int().positive(),
});

const ListOutputSchema = z.object({
  hosting_id: z.number(),
  sites: z.array(SiteSchema),
});

export const listSitesTool = defineTool({
  name: "infomaniak_list_sites",
  description: "Lists all sites on a given web hosting (with applications attached).",
  inputSchema: ListInputSchema,
  outputSchema: ListOutputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input) => {
    const client = new PublicApiClient();
    const sites = await client.request<Array<unknown>>(
      "GET",
      `/1/web_hostings/${input.hosting_id}/sites`,
      { query: { "with[]": "applications", page: 1, per_page: 100 } },
    );
    return {
      hosting_id: input.hosting_id,
      sites: sites.map((s) => SiteSchema.parse(s)),
    };
  },
});

// --- create_site -----------------------------------------------------------

const CreateInputSchema = z.object({
  hosting_id: z.number().int().positive(),
  /** FQDN of the new site, e.g. "blog.example.com". */
  fqdn: z
    .string()
    .min(3)
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "fqdn must look like 'sub.example.com'"),
  /**
   * Filesystem directory under the hosting. If omitted, defaults to
   * "/sites/{fqdn}" which mirrors the manager wizard's behavior.
   */
  directory: z
    .string()
    .regex(/^\/sites\/[\w.-]+$/, "directory must start with /sites/")
    .optional(),
  /** Server environment — defaults to apache_php (use "nodejs" for hosting_3). */
  environment: z.enum(["apache_php", "nodejs"]).default("apache_php"),
  /**
   * Two-phase commit token. Omit on first call to receive a plan + token,
   * then call again with the same token to actually create the site.
   */
  confirmation_token: z.string().uuid().optional(),
});

const CreatePlanSchema = z.object({
  status: z.literal("plan"),
  plan: z.object({
    hosting_id: z.number(),
    fqdn: z.string(),
    directory: z.string(),
    environment: z.string(),
    payload_preview: z.record(z.unknown()),
  }),
  confirmation_token: z.string(),
  token_expires_at: z.string(),
  next_step_markdown: z.string(),
});

const CreateAppliedSchema = z.object({
  status: z.literal("applied"),
  progress_id: z.string(),
  fqdn: z.string(),
  hosting_id: z.number(),
  message: z.string(),
});

const CreateOutputSchema = z.union([CreatePlanSchema, CreateAppliedSchema]);

export const createSiteTool = defineTool({
  name: "infomaniak_create_site",
  description:
    "Creates a new site on an Infomaniak web hosting. Two-phase commit: first call returns a plan with a confirmation_token, second call (same params + token) actually creates the site.",
  inputSchema: CreateInputSchema,
  outputSchema: CreateOutputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: async (input) => {
    const directory = input.directory ?? `/sites/${input.fqdn}`;
    const fingerprint = JSON.stringify({
      tool: "infomaniak_create_site",
      hosting_id: input.hosting_id,
      fqdn: input.fqdn,
      directory,
      environment: input.environment,
    });
    const payload = {
      fqdn: input.fqdn,
      directory,
      force_fqdn: true,
      environment: input.environment,
    };

    if (!input.confirmation_token) {
      const { token, expiresAt } = mintToken(fingerprint);
      const ttlSec = Math.round((expiresAt.getTime() - Date.now()) / 1000);
      return {
        status: "plan" as const,
        plan: {
          hosting_id: input.hosting_id,
          fqdn: input.fqdn,
          directory,
          environment: input.environment,
          payload_preview: payload,
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — create site \`${input.fqdn}\``,
          ``,
          `- **Hosting**: ${input.hosting_id}`,
          `- **FQDN**: \`${input.fqdn}\``,
          `- **Directory**: \`${directory}\``,
          `- **Environment**: \`${input.environment}\``,
          ``,
          `### Side effects`,
          `- A new site entry will appear in the manager.`,
          `- The DNS A record will be auto-created if the parent domain is managed by Infomaniak.`,
          `- Let's Encrypt SSL will be issued shortly after creation (a few minutes).`,
          ``,
          `### Next step`,
          `Re-call \`infomaniak_create_site\` with the same parameters AND \`confirmation_token: "${token}"\` (expires in ${ttlSec}s).`,
        ].join("\n"),
      };
    }

    if (!consumeToken(input.confirmation_token, fingerprint)) {
      throw new Error(
        "Confirmation token is invalid, expired, or doesn't match the parameters. " +
          "Re-call this tool without confirmation_token to obtain a fresh plan.",
      );
    }

    log.info({ fqdn: input.fqdn, hosting_id: input.hosting_id }, "Creating site");
    const manager = new ManagerApiClient();
    const response = await manager.request<{ progress_id: string }>(
      "POST",
      `/proxy/1/web_hostings/${input.hosting_id}/sites`,
      { body: payload },
    );

    recordHistory({
      tool: "infomaniak_create_site",
      kind: "create_site",
      summary: `Created site ${input.fqdn} on hosting ${input.hosting_id}`,
      payload: { ...payload, progress_id: response.progress_id },
      // We can't undo the creation directly because we don't yet know the
      // site_id (it's assigned async via progress_id). The user can call
      // infomaniak_delete_site once the manager has provisioned the site.
    });

    return {
      status: "applied" as const,
      progress_id: response.progress_id,
      fqdn: input.fqdn,
      hosting_id: input.hosting_id,
      message: `✅ Site \`${input.fqdn}\` is being provisioned. It should appear in the manager within 10-30 seconds.`,
    };
  },
});

// --- delete_site -----------------------------------------------------------

const DeleteSiteInput = z.object({
  hosting_id: z.number().int().positive(),
  site_id: z.number().int().positive(),
  confirmation_token: z.string().uuid().optional(),
});

const DeleteSitePlanSchema = z.object({
  status: z.literal("plan"),
  plan: z.object({
    hosting_id: z.number(),
    site_id: z.number(),
    site_preview: SiteSchema,
  }),
  confirmation_token: z.string(),
  token_expires_at: z.string(),
  next_step_markdown: z.string(),
});

const DeleteSiteAppliedSchema = z.object({
  status: z.literal("applied"),
  hosting_id: z.number(),
  site_id: z.number(),
  message: z.string(),
});

const DeleteSiteOutputSchema = z.union([DeleteSitePlanSchema, DeleteSiteAppliedSchema]);

export const deleteSiteTool = defineTool({
  name: "infomaniak_delete_site",
  description:
    "Delete a site from an Infomaniak web hosting. Two-phase commit: first call returns a plan with the site preview + token, second call (same params + token) actually deletes. WARNING: this also wipes the site directory on the FTP backend after a short grace period.",
  inputSchema: DeleteSiteInput,
  outputSchema: DeleteSiteOutputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const fingerprint = JSON.stringify({
      tool: "infomaniak_delete_site",
      hosting_id: input.hosting_id,
      site_id: input.site_id,
    });

    if (!input.confirmation_token) {
      // Pull the site detail so the user sees exactly what will disappear.
      const publicClient = new PublicApiClient();
      const preview = await publicClient.request<unknown>(
        "GET",
        `/1/web_hostings/${input.hosting_id}/sites/${input.site_id}`,
      );
      const parsed = SiteSchema.parse(preview);
      const { token, expiresAt } = mintToken(fingerprint);
      return {
        status: "plan" as const,
        plan: {
          hosting_id: input.hosting_id,
          site_id: input.site_id,
          site_preview: parsed,
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — delete site \`${parsed.customer_name}\``,
          ``,
          `- **Site id**: ${input.site_id}`,
          `- **Hosting**: ${input.hosting_id}`,
          `- **FQDN**: \`${parsed.main_fqdn ?? parsed.customer_name}\``,
          ...(parsed.directory ? [`- **Directory**: \`${parsed.directory}\``] : []),
          ...(parsed.applications && parsed.applications.length > 0
            ? [
                `- **Applications**: ${parsed.applications
                  .map((a) => `${a.type} ${a.version ?? ""}`.trim())
                  .join(", ")}`,
              ]
            : []),
          ``,
          `### ⚠️ This is irreversible`,
          `- The site will disappear from the manager.`,
          `- Any installed application (WordPress, etc.) and its data is removed.`,
          `- The directory on the FTP backend may be wiped on the server side as well.`,
          ``,
          `### Next step`,
          `Re-call \`infomaniak_delete_site\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
        ].join("\n"),
      };
    }

    if (!consumeToken(input.confirmation_token, fingerprint)) {
      throw new Error("Confirmation token is invalid, expired, or doesn't match the parameters.");
    }
    log.info({ site_id: input.site_id, hosting_id: input.hosting_id }, "Deleting site");
    const manager = new ManagerApiClient();
    await manager.request<unknown>(
      "DELETE",
      `/proxy/1/web_hostings/${input.hosting_id}/sites/${input.site_id}`,
    );

    recordHistory({
      tool: "infomaniak_delete_site",
      kind: "delete_site",
      summary: `Deleted site id ${input.site_id} from hosting ${input.hosting_id}`,
      payload: { hosting_id: input.hosting_id, site_id: input.site_id },
    });

    return {
      status: "applied" as const,
      hosting_id: input.hosting_id,
      site_id: input.site_id,
      message: `✅ Site ${input.site_id} deletion requested. The manager should reflect the change within seconds.`,
    };
  },
});
