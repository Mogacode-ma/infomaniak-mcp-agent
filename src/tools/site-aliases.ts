/**
 * Site aliases — add / list / delete additional FQDNs on a web hosting site.
 *
 * An "alias" is a FQDN served by the same Apache vhost (same DocumentRoot)
 * as the site's main FQDN. Lets you serve `xxx.example.com`, `*.example.com`,
 * or a completely different domain from the same WordPress install — without
 * creating a new site on the hosting.
 *
 * Endpoints (manager-private, validated 2026-06-01):
 *   GET    /proxy/1/web_hostings/{hid}/sites/{sid}/aliases?with=domain_options
 *   POST   /proxy/1/web_hostings/{hid}/sites/{sid}/aliases   body: {aliases: ["fqdn1", "fqdn2"]}
 *   DELETE /proxy/1/web_hostings/{hid}/sites/{sid}/aliases/{url-encoded fqdn}
 *
 * Important behaviors:
 *   - POST returns a `progress_id` (asynchronous). The new alias usually
 *     appears in GET after 5-15s of provisioning.
 *   - Wildcards are accepted: `*.app.example.com` is a valid alias (confirmed live).
 *     This makes it possible to serve any subdomain from a single WP install,
 *     without per-subdomain provisioning.
 *   - The DNS for the alias must point to the hosting's IP (Apache vhost
 *     dispatches by Host header). Use `infomaniak_dns_create_record` to add
 *     a matching A record on the zone you control.
 *   - For an HTTPS wildcard cert covering the wildcard alias, request a Let's
 *     Encrypt cert via `infomaniak_request_certificate(type="free")` AFTER the
 *     alias and DNS are in place — Infomaniak's ACME flow validates against
 *     the FQDN that's bound to the site.
 */
import { z } from "zod";

import { ManagerApiClient } from "../api/http.js";
import { consumeToken, mintToken } from "../utils/confirmation.js";
import { recordHistory } from "../utils/history.js";

import { defineTool } from "./types.js";

// ---------------------------------------------------------------------------
// Shared schema
// ---------------------------------------------------------------------------

const SiteAliasSchema = z.object({
  name: z.string(),
  fqdn_idn: z.string().optional(),
  can_update_dns: z.boolean().optional(),
  is_synonym: z.boolean().optional(),
  /** True for the main FQDN of the site. */
  is_main: z.boolean(),
  /** True for FQDNs Infomaniak considers protected (typically the main + www variants). */
  is_protected: z.boolean().optional(),
  domain_options: z
    .object({
      has_domain_privacy: z.boolean().optional(),
      has_renewal_warranty: z.boolean().optional(),
      has_dns_anycast: z.boolean().optional(),
    })
    .passthrough()
    .optional(),
});

// ---------------------------------------------------------------------------
// list_site_aliases
// ---------------------------------------------------------------------------

const ListSiteAliasesInput = z.object({
  hosting_id: z
    .number()
    .int()
    .positive()
    .describe("Web hosting id. Discover via infomaniak_list_hostings / infomaniak_find_site."),
  site_id: z
    .number()
    .int()
    .positive()
    .describe("Site id on the hosting. Discover via infomaniak_find_site."),
});

const ListSiteAliasesOutput = z.object({
  hosting_id: z.number(),
  site_id: z.number(),
  count: z.number(),
  main_fqdn: z.string().optional(),
  aliases: z.array(SiteAliasSchema),
});

export const listSiteAliasesTool = defineTool({
  name: "infomaniak_list_site_aliases",
  description:
    "List the FQDNs (main + aliases) bound to a web hosting site. The site responds to all of them via the same Apache vhost / DocumentRoot — adding an alias is how you serve more domains from a single WordPress install without provisioning a new site. Manager-private.",
  inputSchema: ListSiteAliasesInput,
  outputSchema: ListSiteAliasesOutput,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const client = new ManagerApiClient();
    const aliases = await client.request<z.infer<typeof SiteAliasSchema>[]>(
      "GET",
      `/proxy/1/web_hostings/${input.hosting_id}/sites/${input.site_id}/aliases`,
      { query: { page: 1, per_page: 100, "with[]": "domain_options" } },
    );
    const main = aliases.find((a) => a.is_main);
    return {
      hosting_id: input.hosting_id,
      site_id: input.site_id,
      count: aliases.length,
      ...(main?.name !== undefined && { main_fqdn: main.name }),
      aliases,
    };
  },
});

// ---------------------------------------------------------------------------
// add_site_aliases (two-phase commit)
// ---------------------------------------------------------------------------

const AddSiteAliasesInput = z.object({
  hosting_id: z.number().int().positive(),
  site_id: z.number().int().positive(),
  aliases: z
    .array(z.string().min(3))
    .min(1)
    .describe(
      "One or more FQDNs to bind to the site. WILDCARDS ARE ACCEPTED (e.g. `*.app.example.com`) — use this pattern to serve any subdomain from a single WordPress install. The DNS for each alias must already point to the hosting's IP, otherwise Apache will respond but the browser will never reach it.",
    ),
  confirmation_token: z
    .string()
    .uuid()
    .optional()
    .describe("Token from the prior plan response. Required on the apply phase only."),
});

const AddSiteAliasesOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      hosting_id: z.number(),
      site_id: z.number(),
      site_main_fqdn: z.string().optional(),
      aliases_to_add: z.array(z.string()),
      includes_wildcard: z.boolean(),
      already_present: z.array(z.string()),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    progress_id: z.string(),
    message: z.string(),
    note: z.string(),
  }),
]);

export const addSiteAliasesTool = defineTool({
  name: "infomaniak_add_site_aliases",
  description:
    "Bind one or more additional FQDNs (including wildcards like `*.example.com`) to a web hosting site. Lets the site's Apache vhost / DocumentRoot serve those new domains too — no new site provisioning required. Two-phase commit. Asynchronous: returns a `progress_id`; the alias appears in `infomaniak_list_site_aliases` after a few seconds of provisioning. Manager-private.",
  inputSchema: AddSiteAliasesInput,
  outputSchema: AddSiteAliasesOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: async (input) => {
    const fingerprint = JSON.stringify({
      tool: "infomaniak_add_site_aliases",
      hosting_id: input.hosting_id,
      site_id: input.site_id,
      aliases: [...input.aliases].sort(),
    });
    const client = new ManagerApiClient();
    const includesWildcard = input.aliases.some((a) => a.includes("*"));

    if (!input.confirmation_token) {
      // PLAN: introspect current state
      let mainFqdn: string | undefined;
      const alreadyPresent: string[] = [];
      try {
        const existing = await client.request<z.infer<typeof SiteAliasSchema>[]>(
          "GET",
          `/proxy/1/web_hostings/${input.hosting_id}/sites/${input.site_id}/aliases`,
        );
        const existingNames = new Set(existing.map((a) => a.name));
        mainFqdn = existing.find((a) => a.is_main)?.name;
        for (const a of input.aliases) {
          if (existingNames.has(a)) alreadyPresent.push(a);
        }
      } catch {
        // Non-fatal: planning works without introspection.
      }

      const { token, expiresAt } = mintToken(fingerprint);
      const toAdd = input.aliases.filter((a) => !alreadyPresent.includes(a));

      return {
        status: "plan" as const,
        plan: {
          hosting_id: input.hosting_id,
          site_id: input.site_id,
          ...(mainFqdn !== undefined && { site_main_fqdn: mainFqdn }),
          aliases_to_add: toAdd,
          includes_wildcard: includesWildcard,
          already_present: alreadyPresent,
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — add site aliases`,
          ``,
          `- **Hosting**: ${input.hosting_id}`,
          `- **Site**: ${input.site_id}${mainFqdn ? ` (\`${mainFqdn}\`)` : ""}`,
          `- **Aliases to add**: ${toAdd.length === 0 ? "*(none — all already present)*" : toAdd.map((a) => `\`${a}\``).join(", ")}`,
          ...(alreadyPresent.length > 0
            ? [`- **Already present (no-op)**: ${alreadyPresent.map((a) => `\`${a}\``).join(", ")}`]
            : []),
          ...(includesWildcard
            ? [
                ``,
                `⚠️ **Wildcard included.** This will let the site serve **any** sub-domain matching the wildcard. Pair with:`,
                `1. A wildcard DNS record (e.g. \`A *.example.com → <hosting IP>\`) via \`infomaniak_dns_create_record\`.`,
                `2. A Let's Encrypt cert via \`infomaniak_request_certificate(type="free")\` for HTTPS coverage on the new subdomains.`,
              ]
            : []),
          ``,
          `To apply: call this tool again with the same arguments + \`confirmation_token: "${token}"\`.`,
        ].join("\n"),
      };
    }

    // APPLY
    consumeToken(input.confirmation_token, fingerprint);

    const data = await client.request<{ progress_id: string }>(
      "POST",
      `/proxy/1/web_hostings/${input.hosting_id}/sites/${input.site_id}/aliases`,
      { body: { aliases: input.aliases } },
    );

    recordHistory({
      tool: "infomaniak_add_site_aliases",
      kind: "create_site",
      summary: `Added ${input.aliases.length} alias(es) to hosting ${input.hosting_id} site ${input.site_id}: ${input.aliases.join(", ")}`,
      payload: {
        hosting_id: input.hosting_id,
        site_id: input.site_id,
        aliases: input.aliases,
        progress_id: data.progress_id,
        includes_wildcard: includesWildcard,
      },
      undo: {
        tool: "infomaniak_delete_site_alias",
        params: {
          hosting_id: input.hosting_id,
          site_id: input.site_id,
          alias: input.aliases[0],
        },
        description: `Remove the first alias added (${input.aliases[0]}). For multiple aliases call delete_site_alias once per alias.`,
      },
    });

    return {
      status: "applied" as const,
      progress_id: data.progress_id,
      message: `Submitted ${input.aliases.length} alias(es) for provisioning. Poll infomaniak_list_site_aliases to see them appear.`,
      note: "Provisioning is asynchronous; new aliases typically appear in the list after 5–15 seconds.",
    };
  },
});

// ---------------------------------------------------------------------------
// delete_site_alias (two-phase commit, one alias at a time)
// ---------------------------------------------------------------------------

const DeleteSiteAliasInput = z.object({
  hosting_id: z.number().int().positive(),
  site_id: z.number().int().positive(),
  alias: z
    .string()
    .min(3)
    .describe(
      "The FQDN to remove (e.g. `*.app.example.com` or `client1.example.com`). Cannot remove the main FQDN of the site (that's the `is_main: true` entry in the list).",
    ),
  confirmation_token: z.string().uuid().optional(),
});

const DeleteSiteAliasOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      hosting_id: z.number(),
      site_id: z.number(),
      alias: z.string(),
      is_main: z.boolean(),
      is_protected: z.boolean(),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    message: z.string(),
  }),
]);

export const deleteSiteAliasTool = defineTool({
  name: "infomaniak_delete_site_alias",
  description:
    "Remove one alias FQDN from a web hosting site (the main FQDN cannot be removed). Two-phase commit. After this, the site's Apache vhost will no longer respond to the alias. Manager-private.",
  inputSchema: DeleteSiteAliasInput,
  outputSchema: DeleteSiteAliasOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: async (input) => {
    const fingerprint = JSON.stringify({
      tool: "infomaniak_delete_site_alias",
      hosting_id: input.hosting_id,
      site_id: input.site_id,
      alias: input.alias,
    });
    const client = new ManagerApiClient();

    if (!input.confirmation_token) {
      let isMain = false;
      let isProtected = false;
      try {
        const existing = await client.request<z.infer<typeof SiteAliasSchema>[]>(
          "GET",
          `/proxy/1/web_hostings/${input.hosting_id}/sites/${input.site_id}/aliases`,
        );
        const match = existing.find((a) => a.name === input.alias);
        if (match) {
          isMain = match.is_main;
          isProtected = match.is_protected === true;
        }
      } catch {
        // non-fatal
      }

      const { token, expiresAt } = mintToken(fingerprint);
      return {
        status: "plan" as const,
        plan: {
          hosting_id: input.hosting_id,
          site_id: input.site_id,
          alias: input.alias,
          is_main: isMain,
          is_protected: isProtected,
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — delete site alias`,
          ``,
          `- **Hosting**: ${input.hosting_id}`,
          `- **Site**: ${input.site_id}`,
          `- **Alias to remove**: \`${input.alias}\``,
          ...(isMain
            ? [
                ``,
                `🚨 **This is the MAIN FQDN of the site.** Infomaniak will likely refuse the call — change the site's primary FQDN first.`,
              ]
            : isProtected
              ? [
                  ``,
                  `⚠️ This alias is marked \`is_protected\` (typically the main + www variants). The call may be rejected.`,
                ]
              : []),
          ``,
          `To apply: call this tool again with the same arguments + \`confirmation_token: "${token}"\`.`,
        ].join("\n"),
      };
    }

    consumeToken(input.confirmation_token, fingerprint);
    await client.request<true>(
      "DELETE",
      `/proxy/1/web_hostings/${input.hosting_id}/sites/${input.site_id}/aliases/${encodeURIComponent(input.alias)}`,
    );

    recordHistory({
      tool: "infomaniak_delete_site_alias",
      kind: "delete_site",
      summary: `Removed alias \`${input.alias}\` from hosting ${input.hosting_id} site ${input.site_id}`,
      payload: {
        hosting_id: input.hosting_id,
        site_id: input.site_id,
        alias: input.alias,
      },
      undo: {
        tool: "infomaniak_add_site_aliases",
        params: {
          hosting_id: input.hosting_id,
          site_id: input.site_id,
          aliases: [input.alias],
        },
        description: `Re-add the alias \`${input.alias}\` to the site.`,
      },
    });

    return {
      status: "applied" as const,
      message: `Alias \`${input.alias}\` removed from site ${input.site_id}.`,
    };
  },
});
