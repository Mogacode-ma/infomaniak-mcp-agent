/**
 * FTP / SSH user CRUD on a web hosting.
 *
 * Endpoints (all under `/1/web_hostings/{id}/users`):
 *   GET    /1/web_hostings/{id}/users               (verified live)
 *   POST   /1/web_hostings/{id}/users               (required: connection_type, login, password)
 *   DELETE /1/web_hostings/{id}/users/{login}
 *
 * Required-fields list discovered via 422 against an empty POST.
 */
import { z } from "zod";

import { PublicApiClient } from "../api/http.js";
import { consumeToken, mintToken } from "../utils/confirmation.js";
import { recordHistory } from "../utils/history.js";

import { defineTool } from "./types.js";

/**
 * Connection types accepted by Infomaniak's API for hosting users.
 *
 * Discovered via 422 (`validation_rule_in`) on a live h3 hosting on
 * 2026-05-08: only `ftp` (SFTP-only access) and `ssh` (full shell + FTP)
 * are accepted. The previous enum `apache_php / ftp / sftp / nodejs` was
 * a mis-read of the manager UI labels (those describe the *site*
 * environment, not the *user* connection type).
 */
const ConnectionTypeSchema = z.enum(["ftp", "ssh"]);

const HostingUserSchema = z.object({
  login: z.string(),
  environment: z.string().optional(),
  is_active: z.boolean().optional(),
  has_ssh: z.boolean().optional(),
  is_temporary: z.boolean().optional(),
  home_directory: z.string().optional(),
  link_ftp_manager: z.string().optional(),
  link: z.string().optional(),
});

// ---------------------------------------------------------------------------
// list_hosting_users
// ---------------------------------------------------------------------------

const ListInput = z.object({
  hosting_id: z.number().int().positive(),
});

const ListOutput = z.object({
  hosting_id: z.number(),
  count: z.number(),
  users: z.array(HostingUserSchema),
});

export const listHostingUsersTool = defineTool({
  name: "infomaniak_list_hosting_users",
  description:
    "List the FTP / SSH users that have access to a web hosting (with environment and SSH flag).",
  inputSchema: ListInput,
  outputSchema: ListOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input) => {
    const client = new PublicApiClient();
    const users = await client.request<Array<unknown>>(
      "GET",
      `/1/web_hostings/${input.hosting_id}/users`,
    );
    const parsed = users.map((u) => HostingUserSchema.parse(u));
    return {
      hosting_id: input.hosting_id,
      count: parsed.length,
      users: parsed,
    };
  },
});

// ---------------------------------------------------------------------------
// create_hosting_user
// ---------------------------------------------------------------------------

const CreateInput = z.object({
  hosting_id: z
    .number()
    .int()
    .positive()
    .describe(
      "Web hosting ID where the user will be created. Discover via infomaniak_list_hostings.",
    ),
  login: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-z0-9_-]+$/i, "login must be alphanumeric with _ -")
    .describe(
      "User login WITHOUT the hosting prefix (e.g. 'audit', not 'myprefix_audit'). Alphanumeric + underscore/dash only, 1-32 chars. Infomaniak prepends the hosting prefix automatically.",
    ),
  password: z
    .string()
    .min(8)
    .regex(/[a-z]/, "password must contain at least one lowercase letter")
    .regex(/[A-Z]/, "password must contain at least one uppercase letter")
    .regex(/\d/, "password must contain at least one digit")
    .describe(
      "User password. Minimum 8 chars with at least one lowercase, one uppercase, one digit. Special character recommended but not required.",
    ),
  connection_type: ConnectionTypeSchema.default("ftp").describe(
    "Access level. `ssh` = full shell + FTP/SFTP, `ftp` = SFTP-only (no interactive shell). Default `ftp` (safer).",
  ),
  home_directory: z
    .string()
    .default("/")
    .describe(
      "Sub-path inside the hosting the user is jailed into. Default '/' (root of the hosting). Use to scope an FTP-only user to a single site, e.g. '/sites/example.com'.",
    ),
  confirmation_token: z
    .string()
    .uuid()
    .optional()
    .describe("Token from the prior plan response. Required on the apply phase only."),
});

const CreateOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      hosting_id: z.number(),
      login: z.string(),
      connection_type: ConnectionTypeSchema,
      home_directory: z.string(),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    login: z.string(),
    message: z.string(),
  }),
]);

export const createHostingUserTool = defineTool({
  name: "infomaniak_create_hosting_user",
  description:
    "Create a new FTP / SSH user on a web hosting. Two-phase commit. Connection types: `ftp` (SFTP-only, no shell) or `ssh` (full shell + FTP). The password follows Infomaniak's default policy.",
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
      tool: "infomaniak_create_hosting_user",
      hosting_id: input.hosting_id,
      login: input.login,
      connection_type: input.connection_type,
      home_directory: input.home_directory,
    });
    if (!input.confirmation_token) {
      const { token, expiresAt } = mintToken(fingerprint);
      return {
        status: "plan" as const,
        plan: {
          hosting_id: input.hosting_id,
          login: input.login,
          connection_type: input.connection_type,
          home_directory: input.home_directory,
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — create hosting user`,
          ``,
          `- **Hosting**: ${input.hosting_id}`,
          `- **Login**: \`${input.login}\` (Infomaniak will prepend the hosting prefix)`,
          `- **Connection type**: ${input.connection_type}`,
          `- **Home directory**: \`${input.home_directory}\``,
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
    await client.request<unknown>("POST", `/1/web_hostings/${input.hosting_id}/users`, {
      body: {
        connection_type: input.connection_type,
        login: input.login,
        password: input.password,
        home_directory: input.home_directory,
      },
    });
    recordHistory({
      tool: "infomaniak_create_hosting_user",
      kind: "create_site",
      summary: `Created hosting user ${input.login} on hosting ${input.hosting_id}`,
      payload: {
        hosting_id: input.hosting_id,
        login: input.login,
        connection_type: input.connection_type,
        // password intentionally NOT recorded
      },
      undo: {
        tool: "infomaniak_delete_hosting_user",
        params: { hosting_id: input.hosting_id, login: input.login },
        description: `Delete hosting user ${input.login}`,
      },
    });
    return {
      status: "applied" as const,
      login: input.login,
      message: `✅ User \`${input.login}\` created on hosting ${input.hosting_id}.`,
    };
  },
});

// ---------------------------------------------------------------------------
// delete_hosting_user
// ---------------------------------------------------------------------------

const DeleteInput = z.object({
  hosting_id: z
    .number()
    .int()
    .positive()
    .describe("Web hosting ID. Discover via infomaniak_list_hostings."),
  login: z
    .string()
    .min(1)
    .describe(
      "Full user login as shown by infomaniak_list_hosting_users (includes the hosting prefix, e.g. 'myprefix_audit'). User's files are preserved on disk; only access is revoked.",
    ),
  confirmation_token: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Token from the first (plan) phase. Re-pass on the second call to actually revoke access. Omit on first call to receive the plan + token.",
    ),
});

const DeleteOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      hosting_id: z.number(),
      login: z.string(),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    login: z.string(),
    message: z.string(),
  }),
]);

export const deleteHostingUserTool = defineTool({
  name: "infomaniak_delete_hosting_user",
  description:
    "Revoke a hosting user (FTP / SSH access). Two-phase commit. Existing files are not deleted.",
  inputSchema: DeleteInput,
  outputSchema: DeleteOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const fingerprint = JSON.stringify({
      tool: "infomaniak_delete_hosting_user",
      hosting_id: input.hosting_id,
      login: input.login,
    });
    if (!input.confirmation_token) {
      const { token, expiresAt } = mintToken(fingerprint);
      return {
        status: "plan" as const,
        plan: {
          hosting_id: input.hosting_id,
          login: input.login,
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — revoke hosting user`,
          ``,
          `- **Hosting**: ${input.hosting_id}`,
          `- **Login**: \`${input.login}\``,
          ``,
          `### Note`,
          `This deletes the user account but leaves their files in place.`,
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
    await client.request<unknown>(
      "DELETE",
      `/1/web_hostings/${input.hosting_id}/users/${encodeURIComponent(input.login)}`,
    );
    recordHistory({
      tool: "infomaniak_delete_hosting_user",
      kind: "delete_site",
      summary: `Deleted hosting user ${input.login} on hosting ${input.hosting_id}`,
      payload: { hosting_id: input.hosting_id, login: input.login },
    });
    return {
      status: "applied" as const,
      login: input.login,
      message: `✅ User \`${input.login}\` revoked from hosting ${input.hosting_id}.`,
    };
  },
});
