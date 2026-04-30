/**
 * Database tools — read-only against the documented `/1/web_hostings/...`
 * endpoints (verified live in our exploration of the public Infomaniak API).
 *
 * Write operations (create/delete/reset password) require the manager-private
 * proxy, the same way site creation does. We will add them in v0.4 once we
 * have validated the payload shape against a real test database.
 */
import { z } from "zod";

import { ManagerApiClient, PublicApiClient } from "../api/http.js";
import { consumeToken, mintToken } from "../utils/confirmation.js";
import { recordHistory } from "../utils/history.js";

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

// ---------------------------------------------------------------------------
// create_database
// ---------------------------------------------------------------------------

/**
 * Database creation routes through the manager-private API for the same
 * reason as site creation: the public POST silently no-ops without the
 * Laravel CSRF cookie. See REVERSE-ENGINEERING.md.
 */
const CreateDatabaseInput = z.object({
  hosting_id: z.number().int().positive(),
  /** Database name. Infomaniak prepends the hosting prefix automatically. */
  database_name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_]+$/i, "database_name must be alphanumeric with underscores"),
  description: z.string().max(255).optional(),
  confirmation_token: z.string().uuid().optional(),
});

const CreateDatabaseOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      hosting_id: z.number(),
      database_name: z.string(),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    database_name: z.string(),
    message: z.string(),
  }),
]);

export const createDatabaseTool = defineTool({
  name: "infomaniak_create_database",
  description:
    "Create a new MariaDB database on a web hosting. Two-phase commit. Goes through the manager-private API because the public one silently no-ops on database POSTs.",
  inputSchema: CreateDatabaseInput,
  outputSchema: CreateDatabaseOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: async (input) => {
    const fingerprint = JSON.stringify({
      tool: "infomaniak_create_database",
      hosting_id: input.hosting_id,
      database_name: input.database_name,
    });
    if (!input.confirmation_token) {
      const { token, expiresAt } = mintToken(fingerprint);
      return {
        status: "plan" as const,
        plan: {
          hosting_id: input.hosting_id,
          database_name: input.database_name,
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — create database`,
          ``,
          `- **Hosting**: ${input.hosting_id}`,
          `- **Database**: \`${input.database_name}\` (the hosting prefix will be added automatically)`,
          ``,
          `### Next step`,
          `Re-call with \`confirmation_token: "${token}"\`.`,
        ].join("\n"),
      };
    }
    if (!consumeToken(input.confirmation_token, fingerprint)) {
      throw new Error("Confirmation token is invalid, expired, or doesn't match the parameters.");
    }
    const manager = new ManagerApiClient();
    const payload: Record<string, unknown> = { database_name: input.database_name };
    if (input.description !== undefined) {
      payload["description"] = input.description;
    }
    await manager.request<unknown>("POST", `/proxy/1/web_hostings/${input.hosting_id}/databases`, {
      body: payload,
    });
    recordHistory({
      tool: "infomaniak_create_database",
      kind: "create_database",
      summary: `Created database ${input.database_name} on hosting ${input.hosting_id}`,
      payload: { hosting_id: input.hosting_id, database_name: input.database_name },
      undo: {
        tool: "infomaniak_delete_database",
        params: { hosting_id: input.hosting_id, database_name: input.database_name },
        description: `Delete database ${input.database_name}`,
      },
    });
    return {
      status: "applied" as const,
      database_name: input.database_name,
      message: `✅ Database \`${input.database_name}\` provisioning requested.`,
    };
  },
});

// ---------------------------------------------------------------------------
// delete_database
// ---------------------------------------------------------------------------

const DeleteDatabaseInput = z.object({
  hosting_id: z.number().int().positive(),
  database_name: z.string().min(1),
  confirmation_token: z.string().uuid().optional(),
});

const DeleteDatabaseOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      hosting_id: z.number(),
      database_name: z.string(),
      database_preview: DatabaseSchema,
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    database_name: z.string(),
    message: z.string(),
  }),
]);

export const deleteDatabaseTool = defineTool({
  name: "infomaniak_delete_database",
  description:
    "Delete a MariaDB database. Two-phase commit, manager-private API. WARNING: the database content (tables, rows) is wiped and cannot be recovered without an Infomaniak backup.",
  inputSchema: DeleteDatabaseInput,
  outputSchema: DeleteDatabaseOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const fingerprint = JSON.stringify({
      tool: "infomaniak_delete_database",
      hosting_id: input.hosting_id,
      database_name: input.database_name,
    });
    if (!input.confirmation_token) {
      const publicClient = new PublicApiClient();
      const preview = DatabaseSchema.parse(
        await publicClient.request<unknown>(
          "GET",
          `/1/web_hostings/${input.hosting_id}/databases/${encodeURIComponent(input.database_name)}`,
        ),
      );
      const { token, expiresAt } = mintToken(fingerprint);
      return {
        status: "plan" as const,
        plan: {
          hosting_id: input.hosting_id,
          database_name: input.database_name,
          database_preview: preview,
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — delete database`,
          ``,
          `- **Hosting**: ${input.hosting_id}`,
          `- **Database**: \`${input.database_name}\``,
          ...(preview.disk_used !== null && preview.disk_used !== undefined
            ? [`- **Disk used**: ${preview.disk_used} bytes`]
            : []),
          ...(preview.application ? [`- **Linked application**: \`${preview.application}\``] : []),
          ``,
          `### ⚠️ Irreversible`,
          `All tables, rows and stored data are permanently deleted.`,
          ``,
          `### Next step`,
          `Re-call with \`confirmation_token: "${token}"\`.`,
        ].join("\n"),
      };
    }
    if (!consumeToken(input.confirmation_token, fingerprint)) {
      throw new Error("Confirmation token is invalid, expired, or doesn't match the parameters.");
    }
    const manager = new ManagerApiClient();
    await manager.request<unknown>(
      "DELETE",
      `/proxy/1/web_hostings/${input.hosting_id}/databases/${encodeURIComponent(input.database_name)}`,
    );
    recordHistory({
      tool: "infomaniak_delete_database",
      kind: "delete_database",
      summary: `Deleted database ${input.database_name} on hosting ${input.hosting_id}`,
      payload: { hosting_id: input.hosting_id, database_name: input.database_name },
    });
    return {
      status: "applied" as const,
      database_name: input.database_name,
      message: `✅ Database \`${input.database_name}\` deletion requested.`,
    };
  },
});
