/**
 * DNS tools — read + write against the documented `/2/zones/...` API.
 *
 * - `infomaniak_dns_list_records` — list every record on a zone.
 * - `infomaniak_dns_create_record` — create a record (two-phase commit).
 * - `infomaniak_dns_update_record` — modify a record (two-phase commit).
 * - `infomaniak_dns_delete_record` — delete a record (two-phase commit).
 *
 * The two-phase commit pattern is the same as for site creation
 * (see `tools/sites.ts`): the first call returns a plan + token, the
 * second call (with the token) executes.
 */
import { z } from "zod";

import { PublicApiClient } from "../api/http.js";
import { DnsRecordSchema, DnsRecordTypeSchema } from "../types/infomaniak.js";
import { consumeToken, mintToken } from "../utils/confirmation.js";

import { defineTool } from "./types.js";

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

const ListRecordsInput = z.object({
  zone: z.string().min(3).describe("Zone (root domain), e.g. 'example.com'"),
});

const ListRecordsOutput = z.object({
  zone: z.string(),
  count: z.number(),
  records: z.array(DnsRecordSchema),
});

export const dnsListRecordsTool = defineTool({
  name: "infomaniak_dns_list_records",
  description:
    "List every DNS record on a zone managed by Infomaniak. Use the root domain (e.g. 'example.com'), not a subdomain.",
  inputSchema: ListRecordsInput,
  outputSchema: ListRecordsOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input) => {
    const client = new PublicApiClient();
    const records = await client.request<Array<unknown>>(
      "GET",
      `/2/zones/${encodeURIComponent(input.zone)}/records`,
    );
    const parsed = records.map((r) => DnsRecordSchema.parse(r));
    return { zone: input.zone, count: parsed.length, records: parsed };
  },
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

const CreateRecordInput = z.object({
  zone: z.string().min(3),
  source: z
    .string()
    .describe(
      "Subdomain part (e.g. 'www', 'mail') or '.' for the zone apex. Do NOT include the zone itself.",
    ),
  type: DnsRecordTypeSchema,
  target: z
    .string()
    .min(1)
    .describe(
      "Record value. For MX and SRV, embed the priority inline as Infomaniak does, e.g. '5 mta-gw.infomaniak.ch'.",
    ),
  ttl: z.number().int().min(60).max(86_400).default(3600),
  confirmation_token: z.string().uuid().optional(),
});

const CreateRecordOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      zone: z.string(),
      source: z.string(),
      type: DnsRecordTypeSchema,
      target: z.string(),
      ttl: z.number(),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    record: DnsRecordSchema,
    message: z.string(),
  }),
]);

export const dnsCreateRecordTool = defineTool({
  name: "infomaniak_dns_create_record",
  description:
    "Create a DNS record on an Infomaniak-managed zone. Two-phase commit: first call returns a plan + token, second call (same params + token) actually creates the record.",
  inputSchema: CreateRecordInput,
  outputSchema: CreateRecordOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: async (input) => {
    const fingerprint = JSON.stringify({
      tool: "infomaniak_dns_create_record",
      zone: input.zone,
      source: input.source,
      type: input.type,
      target: input.target,
      ttl: input.ttl,
    });
    const payload: Record<string, unknown> = {
      source: input.source,
      type: input.type,
      target: input.target,
      ttl: input.ttl,
    };

    if (!input.confirmation_token) {
      const { token, expiresAt } = mintToken(fingerprint);
      const fqdn = input.source === "." ? input.zone : `${input.source}.${input.zone}`;
      return {
        status: "plan" as const,
        plan: {
          zone: input.zone,
          source: input.source,
          type: input.type,
          target: input.target,
          ttl: input.ttl,
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — create DNS record`,
          ``,
          `- **Zone**: \`${input.zone}\``,
          `- **Record**: \`${fqdn}\` ${input.type} → \`${input.target}\``,
          `- **TTL**: ${input.ttl}s`,
          ``,
          `### Side effects`,
          `- The record will be created immediately.`,
          `- DNS propagation typically takes 1-5 minutes for short TTLs.`,
          ``,
          `### Next step`,
          `Re-call \`infomaniak_dns_create_record\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
        ].join("\n"),
      };
    }

    if (!consumeToken(input.confirmation_token, fingerprint)) {
      throw new Error("Confirmation token is invalid, expired, or doesn't match the parameters.");
    }
    const client = new PublicApiClient();
    const created = await client.request<unknown>(
      "POST",
      `/2/zones/${encodeURIComponent(input.zone)}/records`,
      { body: payload },
    );
    const parsed = DnsRecordSchema.parse(created);
    return {
      status: "applied" as const,
      record: parsed,
      message: `✅ DNS record created on ${input.zone}.`,
    };
  },
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

const DeleteRecordInput = z.object({
  zone: z.string().min(3),
  record_id: z.number().int().positive(),
  confirmation_token: z.string().uuid().optional(),
});

const DeleteRecordOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      zone: z.string(),
      record_id: z.number(),
      record_preview: DnsRecordSchema,
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    deleted_record_id: z.number(),
    message: z.string(),
  }),
]);

export const dnsDeleteRecordTool = defineTool({
  name: "infomaniak_dns_delete_record",
  description:
    "Delete a DNS record from an Infomaniak-managed zone. Two-phase commit: first call returns a plan with a preview of the record to delete + token, second call (same params + token) actually deletes.",
  inputSchema: DeleteRecordInput,
  outputSchema: DeleteRecordOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const fingerprint = JSON.stringify({
      tool: "infomaniak_dns_delete_record",
      zone: input.zone,
      record_id: input.record_id,
    });
    const client = new PublicApiClient();

    if (!input.confirmation_token) {
      // Fetch the record so the user can verify exactly what they will delete.
      const preview = await client.request<unknown>(
        "GET",
        `/2/zones/${encodeURIComponent(input.zone)}/records/${input.record_id}`,
      );
      const parsed = DnsRecordSchema.parse(preview);
      const { token, expiresAt } = mintToken(fingerprint);
      return {
        status: "plan" as const,
        plan: {
          zone: input.zone,
          record_id: input.record_id,
          record_preview: parsed,
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — delete DNS record`,
          ``,
          `- **Zone**: \`${input.zone}\``,
          `- **Record id**: ${input.record_id}`,
          `- **Type**: ${parsed.type}`,
          `- **Source**: \`${parsed.source}\``,
          `- **Target**: \`${parsed.target}\``,
          ``,
          `### ⚠️ This is irreversible`,
          `Deleting a DNS record can break sites, mail delivery, or third-party integrations.`,
          ``,
          `### Next step`,
          `Re-call \`infomaniak_dns_delete_record\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
        ].join("\n"),
      };
    }

    if (!consumeToken(input.confirmation_token, fingerprint)) {
      throw new Error("Confirmation token is invalid, expired, or doesn't match the parameters.");
    }
    await client.request<unknown>(
      "DELETE",
      `/2/zones/${encodeURIComponent(input.zone)}/records/${input.record_id}`,
    );
    return {
      status: "applied" as const,
      deleted_record_id: input.record_id,
      message: `✅ Record ${input.record_id} deleted from zone ${input.zone}.`,
    };
  },
});
