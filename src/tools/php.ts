/**
 * PHP version tools for web hosting sites.
 *
 * `infomaniak_get_php_version` is read-only and uses the public Bearer API
 * (`GET /1/web_hostings/{id}/sites/{sid}?with[]=environments`): the current
 * PHP branch of a site lives under the `apache_php` environment.
 *
 * `infomaniak_set_php_version` changes the PHP branch. The public Bearer API
 * SILENTLY NO-OPS any attempt to write the PHP version on the site resource
 * (a `php_version` / `php.version` field in a PATCH to
 * `/1/web_hostings/{id}/sites/{sid}` returns `200 success` but changes
 * nothing — verified live). The real write is the manager-private call the
 * Manager UI itself fires:
 *
 *   PATCH /proxy/1/web_hostings/{id}/sites/{sid}   body: {"php":{"version":"8.4"}}
 *
 * (SASESSION + CSRF, same family as create_site / delete_site). A minimal
 * `{"php":{"version":"X.Y"}}` body is enough and PRESERVES the other PHP
 * tuning (memory_limit, max_execution_time, …) — verified live.
 * See REVERSE-ENGINEERING.md.
 *
 * Two-phase commit (plan → confirm) because switching PHP branch on a live
 * site can break an incompatible application.
 */
import { z } from "zod";

import { ManagerApiClient, PublicApiClient } from "../api/http.js";
import { consumeToken, mintToken } from "../utils/confirmation.js";
import { recordHistory } from "../utils/history.js";
import { childLogger } from "../utils/logger.js";

import { defineTool } from "./types.js";

const log = childLogger({ module: "tools/php" });

/** Short PHP branch, e.g. "8.4" (never the full "8.4.21" patch release). */
const PHP_BRANCH_RE = /^\d+\.\d+$/;

interface PhpEnvInfo {
  version_short?: string;
  version_full?: string;
  is_warning?: boolean;
  is_deprecated?: boolean;
  is_alert?: boolean;
  default_version?: boolean;
}

interface SiteEnvironmentsResponse {
  environments?: Array<{ type?: string; php?: PhpEnvInfo }>;
}

/**
 * Reads the current PHP info for a site via the public Bearer API.
 * Returns `undefined` for sites with no `apache_php` environment
 * (Node.js / "starter" hostings have no PHP to change).
 */
async function readPhpInfo(hostingId: number, siteId: number): Promise<PhpEnvInfo | undefined> {
  const client = new PublicApiClient();
  const res = await client.request<SiteEnvironmentsResponse>(
    "GET",
    `/1/web_hostings/${hostingId}/sites/${siteId}`,
    { query: { "with[]": "environments" } },
  );
  const apachePhp = (res.environments ?? []).find((e) => e.type === "apache_php");
  return apachePhp?.php;
}

// --- get_php_version -------------------------------------------------------

const GetInputSchema = z.object({
  hosting_id: z
    .number()
    .int()
    .positive()
    .describe("Web hosting ID. Discover via infomaniak_find_site or infomaniak_list_hostings."),
  site_id: z
    .number()
    .int()
    .positive()
    .describe(
      "Site ID on that hosting. Discover via infomaniak_find_site or infomaniak_list_sites.",
    ),
});

const GetOutputSchema = z.object({
  hosting_id: z.number(),
  site_id: z.number(),
  has_php: z.boolean(),
  version: z.string().nullable(),
  version_full: z.string().nullable(),
  is_warning: z.boolean(),
  is_deprecated: z.boolean(),
  is_alert: z.boolean(),
  is_default_version: z.boolean(),
});

export const getPhpVersionTool = defineTool({
  name: "infomaniak_get_php_version",
  description:
    "Read the current PHP branch (e.g. 8.4) of a web hosting site, with its freshness flags (deprecated/vulnerable). Read-only. Sites with no apache_php environment (Node.js / starter hostings) return has_php=false.",
  inputSchema: GetInputSchema,
  outputSchema: GetOutputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input) => {
    const php = await readPhpInfo(input.hosting_id, input.site_id);
    return {
      hosting_id: input.hosting_id,
      site_id: input.site_id,
      has_php: php !== undefined,
      version: php?.version_short ?? null,
      version_full: php?.version_full ?? null,
      is_warning: php?.is_warning ?? false,
      is_deprecated: php?.is_deprecated ?? false,
      is_alert: php?.is_alert ?? false,
      is_default_version: php?.default_version ?? false,
    };
  },
});

// --- set_php_version -------------------------------------------------------

const SetInputSchema = z.object({
  hosting_id: z
    .number()
    .int()
    .positive()
    .describe("Web hosting ID. Discover via infomaniak_find_site or infomaniak_list_hostings."),
  site_id: z
    .number()
    .int()
    .positive()
    .describe(
      "Site ID on that hosting. Discover via infomaniak_find_site or infomaniak_list_sites.",
    ),
  version: z
    .string()
    .regex(PHP_BRANCH_RE, 'version must be a PHP branch like "8.4" (not the full patch "8.4.21")')
    .describe('Target PHP branch, e.g. "8.4" or "8.5". Must be offered by the hosting.'),
  confirmation_token: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Token returned by the first (plan) phase. Re-pass on the second call to execute. Omit on first call to receive the plan + token.",
    ),
});

const SetPlanSchema = z.object({
  status: z.literal("plan"),
  plan: z.object({
    hosting_id: z.number(),
    site_id: z.number(),
    current_version: z.string().nullable(),
    target_version: z.string(),
  }),
  confirmation_token: z.string(),
  token_expires_at: z.string(),
  next_step_markdown: z.string(),
});

const SetAppliedSchema = z.object({
  status: z.literal("applied"),
  hosting_id: z.number(),
  site_id: z.number(),
  previous_version: z.string().nullable(),
  new_version: z.string(),
  message: z.string(),
});

const SetOutputSchema = z.union([SetPlanSchema, SetAppliedSchema]);

export const setPhpVersionTool = defineTool({
  name: "infomaniak_set_php_version",
  description:
    "Change the PHP branch of a web hosting site (e.g. to 8.4 or 8.5). Two-phase commit: first call returns a plan + confirmation_token, second call (same params + token) applies it via the manager-private API. A minimal change that preserves the site's other PHP tuning. Switching branch on a live site can break an incompatible app — verify the site afterwards.",
  inputSchema: SetInputSchema,
  outputSchema: SetOutputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const fingerprint = JSON.stringify({
      tool: "infomaniak_set_php_version",
      hosting_id: input.hosting_id,
      site_id: input.site_id,
      version: input.version,
    });

    const current = await readPhpInfo(input.hosting_id, input.site_id);
    const currentVersion = current?.version_short ?? null;

    if (!input.confirmation_token) {
      if (current === undefined) {
        throw new Error(
          `Site ${input.site_id} on hosting ${input.hosting_id} has no apache_php environment ` +
            "(Node.js or starter hosting) — there is no PHP version to change.",
        );
      }
      const { token, expiresAt } = mintToken(fingerprint);
      const ttlSec = Math.round((expiresAt.getTime() - Date.now()) / 1000);
      return {
        status: "plan" as const,
        plan: {
          hosting_id: input.hosting_id,
          site_id: input.site_id,
          current_version: currentVersion,
          target_version: input.version,
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — set PHP ${currentVersion ?? "?"} → ${input.version}`,
          ``,
          `- **Hosting**: ${input.hosting_id}`,
          `- **Site**: ${input.site_id}`,
          `- **Current**: \`${currentVersion ?? "unknown"}\``,
          `- **Target**: \`${input.version}\``,
          ``,
          `### Side effects`,
          `- The change is effective immediately on the live site.`,
          `- Other PHP settings (memory_limit, max_execution_time, …) are preserved.`,
          `- Switching branch can break an app that is not compatible — check the site after.`,
          ``,
          `### Next step`,
          `Re-call \`infomaniak_set_php_version\` with the same parameters AND \`confirmation_token: "${token}"\` (expires in ${ttlSec}s).`,
        ].join("\n"),
      };
    }

    if (!consumeToken(input.confirmation_token, fingerprint)) {
      throw new Error(
        "Confirmation token is invalid, expired, or doesn't match the parameters. " +
          "Re-call this tool without confirmation_token to obtain a fresh plan.",
      );
    }

    log.info(
      {
        hosting_id: input.hosting_id,
        site_id: input.site_id,
        from: currentVersion,
        to: input.version,
      },
      "Setting PHP version",
    );
    const manager = new ManagerApiClient();
    await manager.request<unknown>(
      "PATCH",
      `/proxy/1/web_hostings/${input.hosting_id}/sites/${input.site_id}`,
      { body: { php: { version: input.version } } },
    );

    const canUndo = currentVersion !== null && currentVersion !== input.version;
    recordHistory({
      tool: "infomaniak_set_php_version",
      kind: "set_php_version",
      summary: `PHP ${currentVersion ?? "?"} → ${input.version} on site ${input.site_id} (hosting ${input.hosting_id})`,
      payload: {
        hosting_id: input.hosting_id,
        site_id: input.site_id,
        previous_version: currentVersion,
        new_version: input.version,
      },
      ...(canUndo
        ? {
            undo: {
              tool: "infomaniak_set_php_version",
              params: {
                hosting_id: input.hosting_id,
                site_id: input.site_id,
                version: currentVersion,
              },
              description: `Set PHP back to ${currentVersion} on site ${input.site_id}`,
            },
          }
        : {}),
    });

    return {
      status: "applied" as const,
      hosting_id: input.hosting_id,
      site_id: input.site_id,
      previous_version: currentVersion,
      new_version: input.version,
      message: `✅ PHP set to ${input.version} on site ${input.site_id}. Verify the site still renders (a branch switch can break an incompatible app).`,
    };
  },
});
