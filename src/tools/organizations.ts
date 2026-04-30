/**
 * `infomaniak_list_organizations` — lists all Infomaniak organizations
 * (accounts) the current API token has access to.
 */
import { z } from "zod";

import { PublicApiClient } from "../api/http.js";
import { AccountSchema } from "../types/infomaniak.js";

import { defineTool } from "./types.js";

const InputSchema = z.object({});

const OutputSchema = z.object({
  organizations: z.array(AccountSchema),
});

export const listOrganizationsTool = defineTool({
  name: "infomaniak_list_organizations",
  description:
    "Lists all Infomaniak organizations (accounts) the current token has technical access to.",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async () => {
    const client = new PublicApiClient();
    const organizations = await client.request<Array<unknown>>("GET", "/1/account");
    return { organizations: organizations.map((o) => AccountSchema.parse(o)) };
  },
});
