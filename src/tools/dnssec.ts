/**
 * DNSSEC tools — check, enable, disable.
 *
 * Endpoints (under the documented `/2/domains/...` API):
 *   GET  /2/domains/{domain}/dnssec/check    → has_dnssec, dnssec_type, dnssec_data, ksk
 *   POST /2/domains/{domain}/dnssec/enable
 *   POST /2/domains/{domain}/dnssec/disable
 *
 * Live verified: GET on example.com returned the expected key set.
 */
import { z } from "zod";

import { PublicApiClient } from "../api/http.js";
import { consumeToken, mintToken } from "../utils/confirmation.js";
import { recordHistory } from "../utils/history.js";

import { defineTool } from "./types.js";

// ---------------------------------------------------------------------------
// dnssec_check
// ---------------------------------------------------------------------------

const CheckInput = z.object({
  domain: z.string().min(3),
});

const DnssecStatusSchema = z
  .object({
    has_dnssec: z.boolean(),
    dnssec_type: z.string().nullable().optional(),
    dnssec_data: z.unknown().optional(),
    ksk: z.unknown().optional(),
  })
  .passthrough();

export const dnssecCheckTool = defineTool({
  name: "infomaniak_dnssec_check",
  description:
    "Check whether DNSSEC is enabled on a domain and return the active KSK / DS records when present.",
  inputSchema: CheckInput,
  outputSchema: DnssecStatusSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input) => {
    const client = new PublicApiClient();
    return await client.request<unknown>(
      "GET",
      `/2/domains/${encodeURIComponent(input.domain)}/dnssec/check`,
    );
  },
});

// ---------------------------------------------------------------------------
// dnssec_enable / dnssec_disable
// ---------------------------------------------------------------------------

const ToggleInput = z.object({
  domain: z.string().min(3),
  confirmation_token: z.string().uuid().optional(),
});

const ToggleOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({ domain: z.string(), action: z.enum(["enable", "disable"]) }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    domain: z.string(),
    action: z.enum(["enable", "disable"]),
    message: z.string(),
  }),
]);

function makeDnssecToggle(
  toolName: string,
  action: "enable" | "disable",
  description: string,
  warning: string,
) {
  return defineTool({
    name: toolName,
    description,
    inputSchema: ToggleInput,
    outputSchema: ToggleOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (input) => {
      const fingerprint = JSON.stringify({ tool: toolName, domain: input.domain, action });
      if (!input.confirmation_token) {
        const { token, expiresAt } = mintToken(fingerprint);
        return {
          status: "plan" as const,
          plan: { domain: input.domain, action },
          confirmation_token: token,
          token_expires_at: expiresAt.toISOString(),
          next_step_markdown: [
            `## Plan — DNSSEC ${action}`,
            ``,
            `- **Domain**: \`${input.domain}\``,
            ``,
            `### ⚠️ ${warning}`,
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
        `/2/domains/${encodeURIComponent(input.domain)}/dnssec/${action}`,
      );
      recordHistory({
        tool: toolName,
        kind: action === "enable" ? "create_dns_record" : "delete_dns_record",
        summary: `DNSSEC ${action} on ${input.domain}`,
        payload: { domain: input.domain, action },
      });
      return {
        status: "applied" as const,
        domain: input.domain,
        action,
        message: `✅ DNSSEC ${action} requested on \`${input.domain}\`.`,
      };
    },
  });
}

export const dnssecEnableTool = makeDnssecToggle(
  "infomaniak_dnssec_enable",
  "enable",
  "Enable DNSSEC on a domain. Two-phase commit. The registry will publish a DS record automatically; full propagation can take up to 24 hours.",
  "Misconfigured DNSSEC can take a domain offline. Make sure the parent zone is healthy first.",
);

export const dnssecDisableTool = makeDnssecToggle(
  "infomaniak_dnssec_disable",
  "disable",
  "Disable DNSSEC on a domain. Two-phase commit. The DS record is removed at the registry; resolvers will fall back to insecure within the TTL window.",
  "Disabling DNSSEC weakens the integrity of your domain's DNS responses. Only do this temporarily.",
);
