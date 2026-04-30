/**
 * Database tools — read-only against the documented `/1/web_hostings/...`
 * endpoints (verified live in our exploration of the public Infomaniak API).
 *
 * Write operations (create/delete/reset password) require the manager-private
 * proxy, the same way site creation does. We will add them in v0.4 once we
 * have validated the payload shape against a real test database.
 */
import { z } from "zod";

import { PublicApiClient } from "../api/http.js";

import { defineTool } from "./types.js";

const DatabaseSchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  application: z.string().nullable().optional(),
  disk_used: z.number().nullable().optional(),
  permissions: z.unknown().optional(),
  backups: z.unknown().optional(),
  operation_in_progress: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// list_databases
// ---------------------------------------------------------------------------

const ListDatabasesInput = z.object({
  hosting_id: z.number().int().positive(),
});

const ListDatabasesOutput = z.object({
  hosting_id: z.number(),
  count: z.number(),
  databases: z.array(DatabaseSchema),
});

export const listDatabasesTool = defineTool({
  name: "infomaniak_list_databases",
  description:
    "List every MariaDB database attached to a web hosting (with disk usage and any running operations).",
  inputSchema: ListDatabasesInput,
  outputSchema: ListDatabasesOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input) => {
    const client = new PublicApiClient();
    const databases = await client.request<Array<unknown>>(
      "GET",
      `/1/web_hostings/${input.hosting_id}/databases`,
    );
    const parsed = databases.map((d) => DatabaseSchema.parse(d));
    return {
      hosting_id: input.hosting_id,
      count: parsed.length,
      databases: parsed,
    };
  },
});

// ---------------------------------------------------------------------------
// get_database
// ---------------------------------------------------------------------------

const GetDatabaseInput = z.object({
  hosting_id: z.number().int().positive(),
  database_name: z
    .string()
    .min(1)
    .describe("Database name as listed by infomaniak_list_databases (e.g. 'myprefix_WP123456')"),
});

const GetDatabaseOutput = DatabaseSchema;

export const getDatabaseTool = defineTool({
  name: "infomaniak_get_database",
  description:
    "Get the full detail of a specific database (disk usage, application, permissions, backups).",
  inputSchema: GetDatabaseInput,
  outputSchema: GetDatabaseOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input) => {
    const client = new PublicApiClient();
    const data = await client.request<unknown>(
      "GET",
      `/1/web_hostings/${input.hosting_id}/databases/${encodeURIComponent(input.database_name)}`,
    );
    return DatabaseSchema.parse(data);
  },
});
