/**
 * Swiss Backup tools — read-only listing.
 *
 * Endpoint: `GET /1/swiss_backups?account_id={id}` (verified live shape;
 * Patrick's account had 0 swiss-backup products at the time of writing,
 * so the schema is built from the documented response on
 * developer.infomaniak.com → Swiss Backup section).
 */
import { z } from "zod";

import { PublicApiClient } from "../api/http.js";

import { defineTool } from "./types.js";

const SwissBackupSchema = z
  .object({
    id: z.number(),
    customer_name: z.string().optional(),
    description: z.string().nullable().optional(),
    has_maintenance: z.boolean().optional(),
  })
  .passthrough();

const ListInput = z.object({
  account_id: z.number().int().positive(),
});

const ListOutput = z.object({
  account_id: z.number(),
  count: z.number(),
  swiss_backups: z.array(SwissBackupSchema),
});

export const listSwissBackupsTool = defineTool({
  name: "infomaniak_list_swiss_backups",
  description:
    "List Swiss Backup subscriptions on an Infomaniak organization (Acronis-based managed backup).",
  inputSchema: ListInput,
  outputSchema: ListOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input) => {
    const client = new PublicApiClient();
    const data = await client.request<Array<unknown>>("GET", "/1/swiss_backups", {
      query: { account_id: input.account_id },
    });
    return {
      account_id: input.account_id,
      count: data.length,
      swiss_backups: data.map((b) => SwissBackupSchema.parse(b)),
    };
  },
});
