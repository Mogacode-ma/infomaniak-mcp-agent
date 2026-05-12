/**
 * SSL certificate management on web hosting sites.
 *
 * Endpoints (verified live on 2026-05-12 via the public Bearer API):
 *
 *   GET    /1/web_hostings/{hid}/certificates/{site_id}    — current cert status
 *   POST   /1/web_hostings/{hid}/certificates              — request a new cert (3 types)
 *   DELETE /1/web_hostings/{hid}/certificates/{site_id}    — remove the cert
 *
 * Three certificate `type` values are accepted:
 *
 *   - `free`   — Let's Encrypt (no extra fields, Infomaniak runs the ACME flow)
 *   - `paid`   — a pre-purchased Sectigo certificate (requires `certificate_id`)
 *   - `custom` — bring-your-own (requires the PEM certificate; depending on the
 *                shape the manager UI uses, may also require the private key
 *                and chain — the `certificate file or PEM certificate` hint
 *                came verbatim from the API's validation error)
 *
 * The site object itself (returned by `infomaniak_list_sites` /
 * `infomaniak_get_site`) carries `ssl_status` / `ssl_issuer` /
 * `ssl_emitted_at` / `ssl_expired_at` for quick visibility without hitting
 * this endpoint.
 */
import { z } from "zod";

import { PublicApiClient } from "../api/http.js";
import { consumeToken, mintToken } from "../utils/confirmation.js";
import { recordHistory } from "../utils/history.js";

import { defineTool } from "./types.js";

const CertificateTypeSchema = z.enum(["free", "paid", "custom"]);

const CertificateStatusSchema = z.object({
  site_id: z.number(),
  /** Provisioning state: "installed", "updating", "error", "pending", etc. */
  status: z.string(),
  /** Certificate type — same enum as the POST body. */
  type: z.enum(["free", "paid", "custom"]).optional(),
  /** Concrete CA used. For free certs: typically "lets_encrypt". */
  sub_type: z.string().nullable().optional(),
  /** Short issuer identifier (e.g. "R12", "R11" for Let's Encrypt rotations). */
  issuer: z.string().nullable().optional(),
  /** Organization that issued the cert (e.g. "Let's Encrypt"). */
  organization: z.string().nullable().optional(),
  /** Main FQDN this certificate covers. */
  main_fqdn: z.string().optional(),
  /** Same FQDN, IDN form (xn--...). */
  main_fqdn_idn: z.string().optional(),
  /** Unix timestamp (seconds) of when the cert was issued. */
  emitted_at: z.number().nullable().optional(),
  /** Unix timestamp (seconds) of cert expiry. */
  expired_at: z.number().nullable().optional(),
  /** Hex SHA-256 fingerprint, useful for cross-checking what's actually served. */
  fingerprint_sha256: z.string().nullable().optional(),
  /** Whether the certificate is currently valid (signed by a trusted CA, not expired, …). */
  is_valid: z.boolean().optional(),
  /** Whether the certificate has passed its expiry date. */
  is_expired: z.boolean().optional(),
  /** Whether the certificate is a fallback self-signed one. */
  is_selfsigned: z.boolean().optional(),
  /** ACME identifiers that were skipped during issuance (e.g. unreachable domains). */
  ignored_identifiers: z.array(z.unknown()).optional(),
  /** ACME identifiers that errored during issuance, with the reason. */
  error_identifiers: z.array(z.unknown()).optional(),
  /** Top-level certificate error, when applicable. */
  error_on_certificate: z.unknown().nullable().optional(),
  /** Unix timestamp of the last issuance attempt. */
  last_attempt_at: z.number().optional(),
});

// ---------------------------------------------------------------------------
// get_certificate
// ---------------------------------------------------------------------------

const GetCertificateInput = z.object({
  hosting_id: z.number().int().positive(),
  site_id: z.number().int().positive(),
});

const GetCertificateOutput = CertificateStatusSchema;

export const getCertificateTool = defineTool({
  name: "infomaniak_get_certificate",
  description:
    "Return the full SSL certificate detail for one site on a web hosting: provisioning state (`installed`, `updating`, `error`, …), type (free/paid/custom) and sub-type (`lets_encrypt`, …), issuer + organization, validity flags (`is_valid`, `is_expired`, `is_selfsigned`), issue and expiry timestamps, SHA-256 fingerprint, main FQDN in IDN form, ACME identifier errors and the timestamp of the last issuance attempt.",
  inputSchema: GetCertificateInput,
  outputSchema: GetCertificateOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input) => {
    const client = new PublicApiClient();
    const data = await client.request<unknown>(
      "GET",
      `/1/web_hostings/${input.hosting_id}/certificates/${input.site_id}`,
    );
    return CertificateStatusSchema.parse(data);
  },
});

// ---------------------------------------------------------------------------
// request_certificate (issue / re-issue / renew)
// ---------------------------------------------------------------------------

const RequestCertificateInput = z.object({
  hosting_id: z.number().int().positive(),
  site_id: z.number().int().positive(),
  /**
   * `free`   — Let's Encrypt (no extra fields).
   * `paid`   — a pre-purchased Sectigo certificate (requires `certificate_id`).
   * `custom` — bring-your-own PEM certificate (requires `certificate` and
   *            typically `private_key` + optional `intermediate_certificate`).
   */
  type: CertificateTypeSchema,
  /** Required when `type === "paid"` — id of the purchased certificate. */
  certificate_id: z.number().int().positive().optional(),
  /** Required when `type === "custom"` — PEM-encoded certificate string. */
  certificate: z.string().optional(),
  /** Required when `type === "custom"` — PEM-encoded private key. */
  private_key: z.string().optional(),
  /** Optional when `type === "custom"` — PEM-encoded intermediate chain. */
  intermediate_certificate: z.string().optional(),
  confirmation_token: z.string().uuid().optional(),
});

const RequestCertificateOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      hosting_id: z.number(),
      site_id: z.number(),
      type: CertificateTypeSchema,
      uses_certificate_id: z.boolean(),
      uses_custom_pem: z.boolean(),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    operation_uuid: z.string().optional(),
    message: z.string(),
  }),
]);

export const requestCertificateTool = defineTool({
  name: "infomaniak_request_certificate",
  description:
    "Request a new SSL certificate (or re-issue / renew an existing one) for a site on a web hosting. Two-phase commit. Three types supported: `free` (Let's Encrypt, no extra fields), `paid` (Sectigo, requires `certificate_id`), `custom` (BYO PEM, requires `certificate` + `private_key`). Returns an `operation_uuid`; poll `infomaniak_get_certificate` to track progress.",
  inputSchema: RequestCertificateInput,
  outputSchema: RequestCertificateOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: async (input) => {
    // Validate per-type required fields up front
    if (input.type === "paid" && input.certificate_id === undefined) {
      throw new Error("`certificate_id` is required when type=paid.");
    }
    if (input.type === "custom" && (!input.certificate || !input.private_key)) {
      throw new Error("`certificate` and `private_key` are required when type=custom.");
    }

    const fingerprint = JSON.stringify({
      tool: "infomaniak_request_certificate",
      hosting_id: input.hosting_id,
      site_id: input.site_id,
      type: input.type,
      certificate_id: input.certificate_id ?? null,
      certificate_hash: input.certificate ? hashShort(input.certificate) : null,
      private_key_hash: input.private_key ? hashShort(input.private_key) : null,
    });

    if (!input.confirmation_token) {
      const { token, expiresAt } = mintToken(fingerprint);
      return {
        status: "plan" as const,
        plan: {
          hosting_id: input.hosting_id,
          site_id: input.site_id,
          type: input.type,
          uses_certificate_id: input.certificate_id !== undefined,
          uses_custom_pem: input.certificate !== undefined,
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — request SSL certificate`,
          ``,
          `- **Hosting**: ${input.hosting_id}`,
          `- **Site**: ${input.site_id}`,
          `- **Type**: \`${input.type}\``,
          ...(input.type === "free"
            ? [
                `- Let's Encrypt — Infomaniak runs the ACME flow, allow up to a few minutes for ` +
                  `propagation. The current certificate (if any) is replaced.`,
              ]
            : []),
          ...(input.type === "paid"
            ? [`- Sectigo paid certificate id: \`${input.certificate_id}\``]
            : []),
          ...(input.type === "custom"
            ? [
                `- Custom PEM, includes private key. Make sure the certificate is signed by ` +
                  `a CA recognised by browsers, otherwise the site will display a security warning.`,
              ]
            : []),
          ``,
          `### Next step`,
          `Re-call \`infomaniak_request_certificate\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
        ].join("\n"),
      };
    }
    if (!consumeToken(input.confirmation_token, fingerprint)) {
      throw new Error("Confirmation token is invalid, expired, or doesn't match the parameters.");
    }

    const body: Record<string, unknown> = { site_id: input.site_id, type: input.type };
    if (input.certificate_id !== undefined) body["certificate_id"] = input.certificate_id;
    if (input.certificate !== undefined) body["certificate"] = input.certificate;
    if (input.private_key !== undefined) body["private_key"] = input.private_key;
    if (input.intermediate_certificate !== undefined) {
      body["intermediate_certificate"] = input.intermediate_certificate;
    }

    const client = new PublicApiClient();
    const response = await client.request<{ uuid?: string }>(
      "POST",
      `/1/web_hostings/${input.hosting_id}/certificates`,
      { body },
    );

    recordHistory({
      tool: "infomaniak_request_certificate",
      kind: "request_certificate",
      summary: `Requested ${input.type} certificate for site ${input.site_id} on hosting ${input.hosting_id}`,
      payload: {
        hosting_id: input.hosting_id,
        site_id: input.site_id,
        type: input.type,
        // certificate / private_key intentionally NOT recorded
      },
    });

    return {
      status: "applied" as const,
      ...(response?.uuid !== undefined ? { operation_uuid: response.uuid } : {}),
      message:
        `✅ ${input.type === "free" ? "Let's Encrypt" : input.type} certificate ` +
        `requested for site ${input.site_id}. Poll \`infomaniak_get_certificate\` to see when ` +
        `\`status\` transitions from \`updating\` to \`ok\`.`,
    };
  },
});

// ---------------------------------------------------------------------------
// delete_certificate
// ---------------------------------------------------------------------------

const DeleteCertificateInput = z.object({
  hosting_id: z.number().int().positive(),
  site_id: z.number().int().positive(),
  confirmation_token: z.string().uuid().optional(),
});

const DeleteCertificateOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      hosting_id: z.number(),
      site_id: z.number(),
      current_status: z.string().optional(),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    message: z.string(),
  }),
]);

export const deleteCertificateTool = defineTool({
  name: "infomaniak_delete_certificate",
  description:
    "Delete the SSL certificate of a site (the site will fall back to no HTTPS or Infomaniak's default cert until a new one is requested). Two-phase commit. The plan pulls the current certificate status so the caller can see what is about to be removed.",
  inputSchema: DeleteCertificateInput,
  outputSchema: DeleteCertificateOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: async (input) => {
    const fingerprint = JSON.stringify({
      tool: "infomaniak_delete_certificate",
      hosting_id: input.hosting_id,
      site_id: input.site_id,
    });
    if (!input.confirmation_token) {
      // Pull current state for the plan
      const client = new PublicApiClient();
      let currentStatus: string | undefined;
      try {
        const cur = await client.request<{ status?: string }>(
          "GET",
          `/1/web_hostings/${input.hosting_id}/certificates/${input.site_id}`,
        );
        currentStatus = cur?.status;
      } catch {
        // best effort; carry on without it
      }
      const { token, expiresAt } = mintToken(fingerprint);
      return {
        status: "plan" as const,
        plan: {
          hosting_id: input.hosting_id,
          site_id: input.site_id,
          ...(currentStatus !== undefined ? { current_status: currentStatus } : {}),
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — delete SSL certificate`,
          ``,
          `- **Hosting**: ${input.hosting_id}`,
          `- **Site**: ${input.site_id}`,
          ...(currentStatus !== undefined
            ? [`- **Current cert status**: \`${currentStatus}\``]
            : []),
          ``,
          `### ⚠️ Side effects`,
          `- HTTPS on this site will degrade until a new certificate is requested.`,
          `- Visitors may see a browser security warning during that window.`,
          ``,
          `### Next step`,
          `Re-call \`infomaniak_delete_certificate\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
        ].join("\n"),
      };
    }
    if (!consumeToken(input.confirmation_token, fingerprint)) {
      throw new Error("Confirmation token is invalid, expired, or doesn't match the parameters.");
    }
    const client = new PublicApiClient();
    await client.request<unknown>(
      "DELETE",
      `/1/web_hostings/${input.hosting_id}/certificates/${input.site_id}`,
    );
    recordHistory({
      tool: "infomaniak_delete_certificate",
      kind: "delete_certificate",
      summary: `Deleted SSL certificate of site ${input.site_id} on hosting ${input.hosting_id}`,
      payload: { hosting_id: input.hosting_id, site_id: input.site_id },
      undo: {
        tool: "infomaniak_request_certificate",
        params: { hosting_id: input.hosting_id, site_id: input.site_id, type: "free" },
        description: `Re-issue a free (Let's Encrypt) certificate`,
      },
    });
    return {
      status: "applied" as const,
      message: `✅ Certificate of site ${input.site_id} removed.`,
    };
  },
});

// ---------------------------------------------------------------------------
// internal helpers
// ---------------------------------------------------------------------------

/**
 * Short non-cryptographic hash used in the confirmation-token fingerprint so
 * the same plan / apply pair must carry the *same* PEM payload, without ever
 * persisting the PEM itself.
 */
function hashShort(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
