/**
 * Escape hatch — `infomaniak_api_call`.
 *
 * Lets an agent reach any Infomaniak endpoint (the 1500+ documented at
 * developer.infomaniak.com plus the ones we've discovered) without
 * waiting for a dedicated typed tool to be added.
 *
 * Safety guarantees enforced by this tool:
 *
 * 1. **Two-phase commit on any non-GET method.** A POST/PUT/PATCH/DELETE
 *    call returns a plan + token first. The user must explicitly confirm
 *    by calling again with the same parameters and the token.
 *
 * 2. **Public-only by default.** The `api.infomaniak.com` Bearer-token
 *    surface is reachable; the manager-private `/proxy/...` surface is
 *    NOT — too many side effects with too little structure to safely
 *    expose generically. Use the dedicated typed tools (or open a feature
 *    request) for manager-private operations.
 *
 * 3. **Path normalization.** `path` must start with `/{1,2,3}/...`. We
 *    refuse anything that looks like an absolute URL or that escapes
 *    the api.infomaniak.com host.
 */
import { z } from "zod";

import { PublicApiClient } from "../api/http.js";
import { consumeToken, mintToken } from "../utils/confirmation.js";

import { defineTool } from "./types.js";

const HttpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

const PathSchema = z
  .string()
  .min(2)
  .startsWith("/", "path must begin with '/'")
  .regex(
    /^\/\d+\/[A-Za-z0-9_/.{}-]+$/,
    "path must look like /<version>/<route>, e.g. '/1/profile' or '/2/zones/example.com/records'",
  );

const ApiCallInput = z.object({
  method: HttpMethodSchema,
  path: PathSchema,
  /** Optional query string parameters (URL-encoded automatically). */
  query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  /** Optional JSON body for non-GET requests. */
  body: z.unknown().optional(),
  /** Required token returned by a prior plan call (only for non-GET). */
  confirmation_token: z.string().uuid().optional(),
});

const ApiCallOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      method: HttpMethodSchema,
      path: z.string(),
      query: z.record(z.unknown()).optional(),
      body: z.unknown().optional(),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("executed"),
    method: HttpMethodSchema,
    path: z.string(),
    response: z.unknown(),
  }),
]);

export const apiCallTool = defineTool({
  name: "infomaniak_api_call",
  description:
    "Escape hatch: call ANY Infomaniak public API endpoint (api.infomaniak.com) when no dedicated tool exists. GET runs immediately. POST/PUT/PATCH/DELETE follow the two-phase commit pattern. Manager-private (/proxy/...) endpoints are NOT reachable through this tool — use a typed tool instead.",
  inputSchema: ApiCallInput,
  outputSchema: ApiCallOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: async (input) => {
    const isReadOnly = input.method === "GET";
    const fingerprint = JSON.stringify({
      tool: "infomaniak_api_call",
      method: input.method,
      path: input.path,
      query: input.query ?? null,
      body: input.body ?? null,
    });

    // Plan phase for non-GET methods.
    if (!isReadOnly && !input.confirmation_token) {
      const { token, expiresAt } = mintToken(fingerprint);
      return {
        status: "plan" as const,
        plan: {
          method: input.method,
          path: input.path,
          ...(input.query !== undefined ? { query: input.query } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — direct API call`,
          ``,
          `- **Method**: ${input.method}`,
          `- **Path**: \`${input.path}\``,
          ...(input.query ? [`- **Query**: \`${JSON.stringify(input.query)}\``] : []),
          ...(input.body !== undefined
            ? [`- **Body**: \`${JSON.stringify(input.body).slice(0, 200)}\``]
            : []),
          ``,
          `### ⚠️ This is an unstructured destructive call`,
          `Server-side validation will reject malformed payloads. Re-check the docs at https://developer.infomaniak.com/docs/api before confirming.`,
          ``,
          `### Next step`,
          `Re-call \`infomaniak_api_call\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
        ].join("\n"),
      };
    }

    // Apply phase (or read).
    if (!isReadOnly) {
      if (!input.confirmation_token) {
        throw new Error("Internal logic error: non-GET method reached apply path without token.");
      }
      if (!consumeToken(input.confirmation_token, fingerprint)) {
        throw new Error("Confirmation token is invalid, expired, or doesn't match the parameters.");
      }
    }
    const client = new PublicApiClient();
    const response = await client.request<unknown>(input.method, input.path, {
      ...(input.query !== undefined ? { query: input.query } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
    });
    return {
      status: "executed" as const,
      method: input.method,
      path: input.path,
      response,
    };
  },
});
