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

    return {
      status: "applied" as const,
      progress_id: response.progress_id,
      fqdn: input.fqdn,
      hosting_id: input.hosting_id,
      message: `✅ Site \`${input.fqdn}\` is being provisioned. It should appear in the manager within 10-30 seconds.`,
    };
  },
});
