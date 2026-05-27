/**
 * Mail redirection tools — list, create, delete.
 *
 * A "redirection" is a server-side rule that forwards every email
 * arriving at `name@<domain>` to one or more `targets` addresses,
 * without storing a copy locally. Useful for catch-alls, distribution
 * groups, and external forwarding.
 *
 * Endpoints (all under the documented `/1/mail_hostings/...` API):
 *   GET    /1/mail_hostings/{id}/redirections
 *   POST   /1/mail_hostings/{id}/redirections           — required: name, targets
 *   DELETE /1/mail_hostings/{id}/redirections/{name}
 */
import { z } from "zod";

import { PublicApiClient } from "../api/http.js";
import { consumeToken, mintToken } from "../utils/confirmation.js";
import { recordHistory } from "../utils/history.js";

import { defineTool } from "./types.js";

const RedirectionSchema = z
  .object({
    name: z.string(),
    targets: z.array(z.string()),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// list_redirections
// ---------------------------------------------------------------------------

const ListInput = z.object({
  mail_hosting_id: z.number().int().positive(),
});

const ListOutput = z.object({
  mail_hosting_id: z.number(),
  count: z.number(),
  redirections: z.array(RedirectionSchema),
});

export const listRedirectionsTool = defineTool({
  name: "infomaniak_list_redirections",
  description: "List every server-side redirection rule on a mail hosting.",
  inputSchema: ListInput,
  outputSchema: ListOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input) => {
    const client = new PublicApiClient();
    const data = await client.request<Array<unknown>>(
      "GET",
      `/1/mail_hostings/${input.mail_hosting_id}/redirections`,
    );
    const parsed = data.map((r) => RedirectionSchema.parse(r));
    return {
      mail_hosting_id: input.mail_hosting_id,
      count: parsed.length,
      redirections: parsed,
    };
  },
});

// ---------------------------------------------------------------------------
// create_redirection
// ---------------------------------------------------------------------------

const CreateInput = z.object({
  mail_hosting_id: z
    .number()
    .int()
    .positive()
    .describe("Mail hosting ID. Discover via infomaniak_list_mail_hostings."),
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9._-]+$/, "name must be lowercase alphanumeric with . _ -")
    .describe(
      "Local part of the source address (e.g. 'support' to forward 'support@example.com'). Lowercase alphanumeric with dots, underscores or dashes; 1-64 chars. NOT the full email.",
    ),
  targets: z
    .array(z.string().email("targets must be valid email addresses"))
    .min(1)
    .describe(
      "Destination addresses, full emails. Every address must be valid. Multiple targets fan-out (each receives a copy).",
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
      mail_hosting_id: z.number(),
      name: z.string(),
      targets: z.array(z.string()),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    name: z.string(),
    targets: z.array(z.string()),
    message: z.string(),
  }),
]);

export const createRedirectionTool = defineTool({
  name: "infomaniak_create_redirection",
  description:
    "Create a server-side mail redirection. Two-phase commit. Emails received at name@<domain> will be forwarded to every address in targets.",
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
      tool: "infomaniak_create_redirection",
      mail_hosting_id: input.mail_hosting_id,
      name: input.name,
      targets: [...input.targets].sort(),
    });
    if (!input.confirmation_token) {
      const { token, expiresAt } = mintToken(fingerprint);
      return {
        status: "plan" as const,
        plan: {
          mail_hosting_id: input.mail_hosting_id,
          name: input.name,
          targets: input.targets,
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — create mail redirection`,
          ``,
          `- **Mail hosting**: ${input.mail_hosting_id}`,
          `- **From**: \`${input.name}@…\``,
          `- **Forwards to**: ${input.targets.map((t) => `\`${t}\``).join(", ")}`,
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
      "POST",
      `/1/mail_hostings/${input.mail_hosting_id}/redirections`,
      { body: { name: input.name, targets: input.targets } },
    );
    recordHistory({
      tool: "infomaniak_create_redirection",
      kind: "create_dns_record",
      summary: `Created mail redirection ${input.name} → ${input.targets.join(", ")}`,
      payload: {
        mail_hosting_id: input.mail_hosting_id,
        name: input.name,
        targets: input.targets,
      },
      undo: {
        tool: "infomaniak_delete_redirection",
        params: { mail_hosting_id: input.mail_hosting_id, name: input.name },
        description: `Delete redirection ${input.name}`,
      },
    });
    return {
      status: "applied" as const,
      name: input.name,
      targets: input.targets,
      message: `✅ Redirection \`${input.name}\` → ${input.targets.length} target(s) created.`,
    };
  },
});

// ---------------------------------------------------------------------------
// delete_redirection
// ---------------------------------------------------------------------------

const DeleteInput = z.object({
  mail_hosting_id: z
    .number()
    .int()
    .positive()
    .describe("Mail hosting ID. Discover via infomaniak_list_mail_hostings."),
  name: z
    .string()
    .min(1)
    .describe(
      "Local part of the redirection source to remove (e.g. 'support' to delete 'support@example.com'). NOT the full email. List existing rules with infomaniak_list_redirections.",
    ),
  confirmation_token: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Token returned by the first (plan) phase of the two-phase commit. Re-pass it on the second call to actually delete. Omit on first call to receive the plan + token.",
    ),
});

const DeleteOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      mail_hosting_id: z.number(),
      name: z.string(),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    name: z.string(),
    message: z.string(),
  }),
]);

export const deleteRedirectionTool = defineTool({
  name: "infomaniak_delete_redirection",
  description: "Delete a mail redirection. Two-phase commit.",
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
      tool: "infomaniak_delete_redirection",
      mail_hosting_id: input.mail_hosting_id,
      name: input.name,
    });
    if (!input.confirmation_token) {
      const { token, expiresAt } = mintToken(fingerprint);
      return {
        status: "plan" as const,
        plan: {
          mail_hosting_id: input.mail_hosting_id,
          name: input.name,
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — delete mail redirection`,
          ``,
          `- **Mail hosting**: ${input.mail_hosting_id}`,
          `- **Redirection**: \`${input.name}\``,
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
      `/1/mail_hostings/${input.mail_hosting_id}/redirections/${encodeURIComponent(input.name)}`,
    );
    recordHistory({
      tool: "infomaniak_delete_redirection",
      kind: "delete_dns_record",
      summary: `Deleted mail redirection ${input.name}`,
      payload: { mail_hosting_id: input.mail_hosting_id, name: input.name },
    });
    return {
      status: "applied" as const,
      name: input.name,
      message: `✅ Redirection \`${input.name}\` deleted.`,
    };
  },
});
