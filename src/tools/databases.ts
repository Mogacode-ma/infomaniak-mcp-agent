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

/** Real Infomaniak API responses observed in prod (broz.be hosting). */
const DatabaseApplicationSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    type: z.string().optional(),
    name: z.string().optional(),
    location: z.string().optional(),
  })
  .nullable()
  .optional();

const DatabasePermissionSchema = z.object({
  user: z.string(),
  rights: z
    .object({
      read: z.boolean().optional(),
      write: z.boolean().optional(),
      admin: z.boolean().optional(),
    })
    .partial()
    .optional(),
});

const DatabaseSchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  /** Application linking the DB to (e.g. a WordPress install). Was historically a string; the API returns an object. */
  application: z.union([z.string(), DatabaseApplicationSchema]).nullable().optional(),
  disk_used: z.number().nullable().optional(),
  /** List of users with rights on this DB. */
  permissions: z.array(DatabasePermissionSchema).optional(),
  /** Unix timestamps of past backups. */
  backups: z.array(z.number()).optional(),
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
  hosting_id: z
    .number()
    .int()
    .positive()
    .describe(
      "Web hosting ID where the database will live. Discover via infomaniak_find_site(domain) or infomaniak_list_hostings.",
    ),
  database_name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_]+$/i, "database_name must be alphanumeric with underscores")
    .describe(
      "Database name. Alphanumeric and underscores only (no dots, dashes or hyphens), 1-64 chars. Infomaniak automatically prepends the hosting prefix (e.g. 'v33dqc_') — do NOT include it yourself.",
    ),
  description: z
    .string()
    .max(255)
    .optional()
    .describe("Optional description shown in the manager UI (≤ 255 chars)."),
  confirmation_token: z
    .string()
    .uuid()
    .optional()
    .describe("Token from the prior plan response. Required on the apply phase only."),
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

// ---------------------------------------------------------------------------
// list_database_users
//
// Endpoint discovered 2026-05-11:
//   GET /1/web_hostings/{hosting_id}/database_users
//
// Returns the MariaDB-level user accounts that are attached to the hosting's
// databases. Each user has its own password (independent from the FTP/SSH
// user with the same hosting prefix) and a `permissions` array listing which
// databases they have read/write/admin rights on.
//
// For WordPress-managed databases, the user account is "protected": it is
// created automatically when the WP app is provisioned, with one
// permission entry whose `database` is the WP database of the same name.
// ---------------------------------------------------------------------------

const DatabaseUserPermissionSchema = z.object({
  database: z.string(),
  rights: z
    .object({
      read: z.boolean().optional(),
      write: z.boolean().optional(),
      admin: z.boolean().optional(),
    })
    .optional(),
});

const DatabaseUserApplicationSchema = z.object({
  id: z.string(),
  type: z.string().optional(),
  name: z.string().optional(),
});

const DatabaseUserSchema = z.object({
  name: z.string(),
  applications: z.array(DatabaseUserApplicationSchema).optional(),
  permissions: z.array(DatabaseUserPermissionSchema).optional(),
  is_temporary: z.boolean().optional(),
  operation_in_progress: z.boolean().optional(),
  is_unlocked: z.boolean().optional(),
  protected: z.boolean().optional(),
  protected_information: z.string().optional(),
  link: z.string().optional(),
});

const ListDatabaseUsersInput = z.object({
  hosting_id: z.number().int().positive(),
});

const ListDatabaseUsersOutput = z.object({
  hosting_id: z.number(),
  count: z.number(),
  users: z.array(DatabaseUserSchema),
});

export const listDatabaseUsersTool = defineTool({
  name: "infomaniak_list_database_users",
  description:
    "List the MariaDB-level user accounts attached to a web hosting (each has its own password and a `permissions` array listing the databases they can read/write/administer). For WordPress sites the user account has the same name as its database and is marked `protected: true`.",
  inputSchema: ListDatabaseUsersInput,
  outputSchema: ListDatabaseUsersOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input) => {
    const client = new PublicApiClient();
    const users = await client.request<Array<unknown>>(
      "GET",
      `/1/web_hostings/${input.hosting_id}/database_users`,
    );
    const parsed = users.map((u) => DatabaseUserSchema.parse(u));
    return {
      hosting_id: input.hosting_id,
      count: parsed.length,
      users: parsed,
    };
  },
});

// ---------------------------------------------------------------------------
// get_database_user
//
// Endpoint:
//   GET /1/web_hostings/{hosting_id}/database_users/{user_name}
//
// Same shape as a single element of the `list_database_users` response.
// ---------------------------------------------------------------------------

const GetDatabaseUserInput = z.object({
  hosting_id: z.number().int().positive(),
  user_name: z.string().min(1).describe("Full user name including the hosting prefix"),
});

export const getDatabaseUserTool = defineTool({
  name: "infomaniak_get_database_user",
  description:
    "Fetch the detail of a single MariaDB-level user (applications, permissions, link to phpMyAdmin).",
  inputSchema: GetDatabaseUserInput,
  outputSchema: DatabaseUserSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input) => {
    const client = new PublicApiClient();
    const user = await client.request<unknown>(
      "GET",
      `/1/web_hostings/${input.hosting_id}/database_users/${encodeURIComponent(input.user_name)}`,
    );
    return DatabaseUserSchema.parse(user);
  },
});

// ---------------------------------------------------------------------------
// NOT IMPLEMENTED: database_user password reset
//
// The endpoint
//   PATCH /1/web_hostings/{hosting_id}/database_users/{user_name}
// exists and accepts a `password` field that **does** change the MariaDB
// password (verified live: a `mysql -p<new>` succeeds, `mysql -p<old>` is
// rejected with `Access denied`). BUT — and this is critical — the same
// PATCH **silently empties the `applications` and `permissions` arrays** of
// the user, regardless of what is sent in the body. The API responds
// `{"result":"success","data":true}` but the user is left with only
// `GRANT USAGE ON *.* TO ...` and zero database-level grants.
//
// Result: the password "change" is destructive — any WordPress site whose
// wp-config points at this user starts returning `500 Database Error`
// because the user can authenticate but no longer has access to its own
// database. The grants cannot be restored through the public API either
// (POST `/database_users` accepts a `permissions` payload but ignores it,
// PATCH back on the database is also a no-op). The only working repair is
// the manager UI's "Modifier les droits" form, which presumably hits a
// `/proxy/...` endpoint we have not yet reverse-engineered.
//
// Because of this, this MCP intentionally does NOT expose a typed
// `infomaniak_reset_database_password` tool. If you need to rotate a DB
// password, prefer one of:
//
//   1. **Direct MariaDB `ALTER USER`** — SSH into the hosting and run
//      `ALTER USER 'user'@'%' IDENTIFIED BY 'new_password';` (the user has
//      admin rights on its own database so this works without root). This
//      does not touch the Infomaniak API and therefore does not trigger
//      the permissions wipeout.
//   2. **Manager UI** — manager.infomaniak.com → Hosting → Databases →
//      User → Reset password. The UI applies the same fix server-side as
//      it would for permissions.
//
// We will revisit this once the manager-private `/proxy/...` endpoint
// behind "Modifier les droits" is identified (TODO in REVERSE-ENGINEERING.md).
// ---------------------------------------------------------------------------
