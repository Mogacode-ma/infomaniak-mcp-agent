/**
 * URL shortener tools — Infomaniak's official short-URL service.
 *
 * Endpoints:
 *   GET  /2/url-shortener         → list short URLs (verified live)
 *   GET  /2/url-shortener/quota   → { quota, limit }
 *   POST /2/url-shortener         → create a short URL
 */
import { z } from "zod";

import { PublicApiClient } from "../api/http.js";
import { consumeToken, mintToken } from "../utils/confirmation.js";
import { recordHistory } from "../utils/history.js";

import { defineTool } from "./types.js";

const ShortUrlSchema = z
  .object({
    code: z.string().optional(),
    short_url_code: z.string().optional(),
    target: z.string().optional(),
    url: z.string().optional(),
    created_at: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// list_short_urls
// ---------------------------------------------------------------------------

const ListInput = z.object({
  page: z.number().int().min(1).default(1),
  per_page: z.number().int().min(1).max(100).default(20),
});

const ListOutput = z.object({
  page: z.number(),
  per_page: z.number(),
  count: z.number(),
  short_urls: z.array(ShortUrlSchema),
});

export const listShortUrlsTool = defineTool({
  name: "infomaniak_list_short_urls",
  description: "List the short URLs created by your account on Infomaniak's url-shortener service.",
  inputSchema: ListInput,
  outputSchema: ListOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input) => {
    const client = new PublicApiClient();
    const data = await client.request<Array<unknown>>("GET", "/2/url-shortener", {
      query: { page: input.page, per_page: input.per_page },
    });
    return {
      page: input.page,
      per_page: input.per_page,
      count: data.length,
      short_urls: data.map((u) => ShortUrlSchema.parse(u)),
    };
  },
});

// ---------------------------------------------------------------------------
// short_urls_quota
// ---------------------------------------------------------------------------

const QuotaInput = z.object({});

const QuotaOutput = z
  .object({
    quota: z.number(),
    limit: z.number(),
  })
  .passthrough();

export const shortUrlsQuotaTool = defineTool({
  name: "infomaniak_short_urls_quota",
  description: "Return the current consumption and limit of your account's short-URL quota.",
  inputSchema: QuotaInput,
  outputSchema: QuotaOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async () => {
    const client = new PublicApiClient();
    return await client.request<unknown>("GET", "/2/url-shortener/quota");
  },
});

// ---------------------------------------------------------------------------
// create_short_url
// ---------------------------------------------------------------------------

const CreateInput = z.object({
  /** Long URL to shorten. Must be http(s):// */
  target: z.string().url(),
  confirmation_token: z.string().uuid().optional(),
});

const CreateOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({ target: z.string() }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    short_url: z.unknown(),
    message: z.string(),
  }),
]);

export const createShortUrlTool = defineTool({
  name: "infomaniak_create_short_url",
  description:
    "Create a new short URL pointing to a long target. Two-phase commit. Use infomaniak_short_urls_quota first if you're not sure you have headroom.",
  inputSchema: CreateInput,
  outputSchema: CreateOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: async (input) => {
    const fingerprint = JSON.stringify({
      tool: "infomaniak_create_short_url",
      target: input.target,
    });
    if (!input.confirmation_token) {
      const { token, expiresAt } = mintToken(fingerprint);
      return {
        status: "plan" as const,
        plan: { target: input.target },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — create short URL`,
          ``,
          `- **Target**: \`${input.target}\``,
          ``,
          `### Next step`,
          `Re-call with \`confirmation_token: "${token}"\`.`,
        ].join("\n"),
      };
    }
    if (!consumeToken(input.confirmation_token, fingerprint)) {
      throw new Error("Confirmation token is invalid, expired, or doesn't match the parameters.");
    }
    const client = new PublicApiClient();
    const created = await client.request<unknown>("POST", "/2/url-shortener", {
      body: { target: input.target },
    });
    recordHistory({
      tool: "infomaniak_create_short_url",
      kind: "create_dns_record",
      summary: `Created short URL for ${input.target}`,
      payload: { target: input.target, response: created },
    });
    return {
      status: "applied" as const,
      short_url: created,
      message: `✅ Short URL created for \`${input.target}\`.`,
    };
  },
});
