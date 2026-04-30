/**
 * `infomaniak_list_hostings` — lists web hostings within one organization.
 *
 * Filters the global `/1/products` listing to keep only `service_name`
 * matching `hosting` or `hosting_3` (Node.js variant).
 */
import { z } from "zod";

import { PublicApiClient } from "../api/http.js";
import { ProductSchema } from "../types/infomaniak.js";

import { defineTool } from "./types.js";

const InputSchema = z.object({
  /** Organization (account) ID to filter on. */
  account_id: z.number().int().positive(),
  /** Include Node.js (hosting_3) hostings — default true. */
  include_nodejs: z.boolean().default(true),
});

const HostingSchema = ProductSchema.extend({
  is_nodejs: z.boolean(),
});

const OutputSchema = z.object({
  account_id: z.number(),
  hostings: z.array(HostingSchema),
});

export const listHostingsTool = defineTool({
  name: "infomaniak_list_hostings",
  description:
    "Lists web hostings (classic + Node.js) for a given Infomaniak organization. Use infomaniak_list_organizations first to discover account IDs.",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const client = new PublicApiClient();
    const products = await client.request<Array<unknown>>("GET", "/1/products", {
      query: { per_page: 500, account_id: input.account_id },
    });
    const allowed = new Set(input.include_nodejs ? ["hosting", "hosting_3"] : ["hosting"]);
    const hostings = products
      .map((p) => ProductSchema.parse(p))
      .filter((p) => p.account_id === input.account_id && allowed.has(p.service_name))
      .map((p) => ({ ...p, is_nodejs: p.service_name === "hosting_3" }));
    return { account_id: input.account_id, hostings };
  },
});
