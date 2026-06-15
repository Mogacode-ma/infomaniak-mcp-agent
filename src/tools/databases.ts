/**
 * Database tools — read-only against the documented `/1/web_hostings/...`
 * endpoints (verified live in our exploration of the public Infomaniak API).
 *
 * Write operations (create/delete/reset password) require the manager-private
 * proxy, the same way site creation does. We will add them in v0.4 once we
 * have validated the payload shape against a real test database.
 */
import { z } from "zod";

import { InfomaniakError } from "../api/errors.js";
import { ManagerApiClient, PublicApiClient } from "../api/http.js";
import { consumeToken, mintToken } from "../utils/confirmation.js";
import { recordHistory } from "../utils/history.js";

import { defineTool } from "./types.js";

/** Real Infomaniak API responses observed in prod (example.com hosting). */
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
      "Database name. Alphanumeric and underscores only (no dots, dashes or hyphens), 1-64 chars. Infomaniak automatically prepends the hosting prefix (e.g. 'myprefix_') — do NOT include it yourself.",
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
  hosting_id: z
    .number()
    .int()
    .positive()
    .describe(
      "Web hosting ID. Discover via infomaniak_find_site(domain) or infomaniak_list_hostings.",
    ),
  database_name: z
    .string()
    .min(1)
    .describe(
      "Full database name as returned by infomaniak_list_databases (includes the hosting prefix, e.g. 'myprefix_WP1234567'). NOT the unprefixed name you'd pass to create_database.",
    ),
  confirmation_token: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Token from the first (plan) phase. The plan response includes disk usage and any linked application so you can review before confirming. Re-pass to execute.",
    ),
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
// change_db_user_password / change_db_user_permissions
//
// Endpoint (manager-private, REd 2026-06-15 from manager UI XHR capture):
//   PATCH /proxy/1/web_hostings/{hid}/database_users/{user_name}
//   Body: {
//     password?: string,                  // optional — only when rotating
//     permissions: {                      // REQUIRED — every DB on the hosting
//       "db_name_1": { read, write, admin },
//       "db_name_2": { read, write, admin },
//       ...
//     }
//   }
//
// The historical "wipe" bug existed because we were sending
// `permissions: [{database, rights}]` (array) — the server silently
// rejected it and reset the user. The correct shape is an OBJECT keyed
// by db name with every database explicitly listed (false rights on the
// ones the user should NOT access). Stale `MANAGER-XSRF-TOKEN` also
// surfaced as `500 unexpected_error` (not 419) — handled by the retry
// logic in ManagerApiClient.
// ---------------------------------------------------------------------------

const DbGrantSchema = z
  .object({
    database: z.string().min(1).describe("Database name (e.g. `acct_WP1234066`)."),
    read: z.boolean().default(true),
    write: z.boolean().default(true),
    admin: z.boolean().default(true),
  })
  .describe(
    "One grant entry: the database this user should be allowed to access, with the rights to give. Defaults to full read+write+admin.",
  );

/**
 * Build the full `permissions` object the manager-private PATCH expects.
 * Every database on the hosting must be listed; missing ones are treated
 * as a wipe by the server.
 */
async function buildPermissionsObject(
  hostingId: number,
  grants: Array<z.infer<typeof DbGrantSchema>>,
): Promise<Record<string, { read: boolean; write: boolean; admin: boolean }>> {
  const pub = new PublicApiClient();
  const databases = await pub.request<Array<{ name: string }>>(
    "GET",
    `/1/web_hostings/${hostingId}/databases`,
    { query: { page: 1, per_page: 100 } },
  );
  const grantsByDb = new Map(grants.map((g) => [g.database, g]));
  const permissions: Record<string, { read: boolean; write: boolean; admin: boolean }> = {};
  for (const db of databases) {
    const g = grantsByDb.get(db.name);
    permissions[db.name] = g
      ? { read: g.read, write: g.write, admin: g.admin }
      : { read: false, write: false, admin: false };
  }
  // Include any requested DBs that don't (yet) exist on the hosting.
  for (const g of grants) {
    if (!(g.database in permissions)) {
      permissions[g.database] = { read: g.read, write: g.write, admin: g.admin };
    }
  }
  return permissions;
}

// ---------------------------------------------------------------------------
// change_database_user_password (two-phase commit)
// ---------------------------------------------------------------------------

const ChangeDatabaseUserPasswordInput = z.object({
  hosting_id: z.number().int().positive().describe("Web hosting id."),
  user_name: z.string().min(1).describe("MariaDB user name (e.g. `acct_WP1234066`)."),
  new_password: z
    .string()
    .min(8)
    .describe("New password for the MariaDB user (server enforces complexity rules)."),
  grants: z
    .array(DbGrantSchema)
    .min(1)
    .describe(
      "FULL list of databases this user should have access to AFTER the change. Anything not in this list is set to no-access. Tip: call `infomaniak_get_database_user` first and copy the current `permissions` to preserve them.",
    ),
  confirmation_token: z
    .string()
    .uuid()
    .optional()
    .describe("Token from the prior plan response. Required on apply only."),
});

const ChangeDatabaseUserPasswordOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      hosting_id: z.number(),
      user_name: z.string(),
      grants_after: z.array(DbGrantSchema),
      grants_dropped: z.array(z.string()),
      grants_kept: z.array(z.string()),
      password_will_change: z.boolean(),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    hosting_id: z.number(),
    user_name: z.string(),
    note: z.string(),
  }),
]);

export const changeDatabaseUserPasswordTool = defineTool({
  name: "infomaniak_change_database_user_password",
  description:
    "Rotate a MariaDB user's password AND set its database grants atomically. Manager-private PATCH that preserves grants (the public-API PATCH silently wipes permissions; this uses the manager-private endpoint with the correct full-permissions-object shape). Two-phase commit. The `grants` array declares EVERY database this user should access — anything omitted is set to no-access. Tip: call `infomaniak_get_database_user` first and copy current `permissions`. Manager-private.",
  inputSchema: ChangeDatabaseUserPasswordInput,
  outputSchema: ChangeDatabaseUserPasswordOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: async (input) => {
    const fingerprint = JSON.stringify({
      tool: "infomaniak_change_database_user_password",
      hosting_id: input.hosting_id,
      user_name: input.user_name,
      grants: [...input.grants].sort((a, b) => a.database.localeCompare(b.database)),
    });

    if (!input.confirmation_token) {
      const pub = new PublicApiClient();
      const current = await pub
        .request<{
          permissions?: Array<{ database: string }>;
        }>(
          "GET",
          `/1/web_hostings/${input.hosting_id}/database_users/${encodeURIComponent(input.user_name)}`,
        )
        .catch(() => ({ permissions: [] as Array<{ database: string }> }));
      const currentDbs = new Set((current.permissions ?? []).map((p) => p.database));
      const requestedDbs = new Set(input.grants.map((g) => g.database));
      const dropped = [...currentDbs].filter((d) => !requestedDbs.has(d));
      const kept = [...currentDbs].filter((d) => requestedDbs.has(d));

      const { token, expiresAt } = mintToken(fingerprint);
      return {
        status: "plan" as const,
        plan: {
          hosting_id: input.hosting_id,
          user_name: input.user_name,
          grants_after: input.grants,
          grants_dropped: dropped,
          grants_kept: kept,
          password_will_change: true,
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — rotate MariaDB user password`,
          ``,
          `- **Hosting**: ${input.hosting_id}`,
          `- **User**: \`${input.user_name}\``,
          `- **New password**: *(set, redacted)*`,
          `- **Grants AFTER**: ${input.grants.length === 0 ? "*(none)*" : input.grants.map((g) => `\`${g.database}\` (${[g.read && "r", g.write && "w", g.admin && "a"].filter(Boolean).join("")})`).join(", ")}`,
          ...(dropped.length > 0
            ? [
                `- ⚠️ **Grants that will be DROPPED**: ${dropped.map((d) => `\`${d}\``).join(", ")} — any site using this user against these DBs will lose access.`,
              ]
            : []),
          ...(kept.length > 0 ? [`- Grants kept: ${kept.map((d) => `\`${d}\``).join(", ")}`] : []),
          ``,
          `Re-call this tool with \`confirmation_token: "${token}"\` to apply.`,
        ].join("\n"),
      };
    }

    if (!consumeToken(input.confirmation_token, fingerprint)) {
      throw new InfomaniakError({
        message: "Confirmation token expired, already used, or does not match this operation.",
        actionable: "Re-call the tool without confirmation_token to get a fresh plan + token.",
      });
    }
    const permissions = await buildPermissionsObject(input.hosting_id, input.grants);
    const manager = new ManagerApiClient();
    await manager.request<unknown>(
      "PATCH",
      `/proxy/1/web_hostings/${input.hosting_id}/database_users/${encodeURIComponent(input.user_name)}`,
      { body: { password: input.new_password, permissions } },
    );
    recordHistory({
      tool: "infomaniak_change_database_user_password",
      kind: "create_database",
      summary: `Rotated password for DB user ${input.user_name} on hosting ${input.hosting_id}`,
      payload: {
        hosting_id: input.hosting_id,
        user_name: input.user_name,
        grants_count: input.grants.length,
      },
    });
    return {
      status: "applied" as const,
      hosting_id: input.hosting_id,
      user_name: input.user_name,
      note: "Password rotated and grants set. Any client (wp-config.php, etc.) using the old password must be updated to the new one.",
    };
  },
});

// ---------------------------------------------------------------------------
// change_database_user_permissions (two-phase commit, no password change)
// ---------------------------------------------------------------------------

const ChangeDatabaseUserPermissionsInput = z.object({
  hosting_id: z.number().int().positive(),
  user_name: z.string().min(1),
  grants: z
    .array(DbGrantSchema)
    .describe(
      "FULL list of databases this user should access. Empty list = revoke ALL grants (user can no longer access any database).",
    ),
  confirmation_token: z.string().uuid().optional(),
});

const ChangeDatabaseUserPermissionsOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      hosting_id: z.number(),
      user_name: z.string(),
      grants_after: z.array(DbGrantSchema),
      grants_dropped: z.array(z.string()),
      grants_kept: z.array(z.string()),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    hosting_id: z.number(),
    user_name: z.string(),
    grants_after: z.array(DbGrantSchema),
  }),
]);

export const changeDatabaseUserPermissionsTool = defineTool({
  name: "infomaniak_change_database_user_permissions",
  description:
    "Update which databases a MariaDB user can access (read/write/admin per DB). Does NOT change the password. Same manager-private endpoint as the password rotation. Two-phase commit. Anything not in `grants` is set to no-access — this is the canonical way to revoke a grant. Manager-private.",
  inputSchema: ChangeDatabaseUserPermissionsInput,
  outputSchema: ChangeDatabaseUserPermissionsOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const fingerprint = JSON.stringify({
      tool: "infomaniak_change_database_user_permissions",
      hosting_id: input.hosting_id,
      user_name: input.user_name,
      grants: [...input.grants].sort((a, b) => a.database.localeCompare(b.database)),
    });

    if (!input.confirmation_token) {
      const pub = new PublicApiClient();
      const current = await pub
        .request<{
          permissions?: Array<{ database: string }>;
        }>(
          "GET",
          `/1/web_hostings/${input.hosting_id}/database_users/${encodeURIComponent(input.user_name)}`,
        )
        .catch(() => ({ permissions: [] as Array<{ database: string }> }));
      const currentDbs = new Set((current.permissions ?? []).map((p) => p.database));
      const requestedDbs = new Set(input.grants.map((g) => g.database));
      const dropped = [...currentDbs].filter((d) => !requestedDbs.has(d));
      const kept = [...currentDbs].filter((d) => requestedDbs.has(d));

      const { token, expiresAt } = mintToken(fingerprint);
      return {
        status: "plan" as const,
        plan: {
          hosting_id: input.hosting_id,
          user_name: input.user_name,
          grants_after: input.grants,
          grants_dropped: dropped,
          grants_kept: kept,
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — change MariaDB user grants`,
          ``,
          `- **Hosting**: ${input.hosting_id}`,
          `- **User**: \`${input.user_name}\``,
          `- **Grants AFTER**: ${input.grants.length === 0 ? "*(none — all revoked)*" : input.grants.map((g) => `\`${g.database}\` (${[g.read && "r", g.write && "w", g.admin && "a"].filter(Boolean).join("")})`).join(", ")}`,
          ...(dropped.length > 0
            ? [`- ⚠️ **Grants that will be DROPPED**: ${dropped.map((d) => `\`${d}\``).join(", ")}`]
            : []),
          ``,
          `Re-call with \`confirmation_token: "${token}"\` to apply.`,
        ].join("\n"),
      };
    }

    if (!consumeToken(input.confirmation_token, fingerprint)) {
      throw new InfomaniakError({
        message: "Confirmation token expired, already used, or does not match this operation.",
        actionable: "Re-call the tool without confirmation_token to get a fresh plan + token.",
      });
    }
    const permissions = await buildPermissionsObject(input.hosting_id, input.grants);
    const manager = new ManagerApiClient();
    await manager.request<unknown>(
      "PATCH",
      `/proxy/1/web_hostings/${input.hosting_id}/database_users/${encodeURIComponent(input.user_name)}`,
      { body: { permissions } },
    );
    recordHistory({
      tool: "infomaniak_change_database_user_permissions",
      kind: "create_database",
      summary: `Updated DB grants for ${input.user_name} on hosting ${input.hosting_id}`,
      payload: {
        hosting_id: input.hosting_id,
        user_name: input.user_name,
        grants_count: input.grants.length,
      },
    });
    return {
      status: "applied" as const,
      hosting_id: input.hosting_id,
      user_name: input.user_name,
      grants_after: input.grants,
    };
  },
});
