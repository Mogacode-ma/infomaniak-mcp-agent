/**
 * Profile / identity self-introspection tools.
 *
 * Endpoints (manager-private):
 *   GET /proxy/2/profile?with=*           — full profile (name, email, language, country, timezone, current_account)
 *   GET /proxy/2/profile?with=security    — 2FA status, auth devices, last_login, security_score, rescue codes
 *   GET /proxy/2/profile?with=emails      — verified emails list
 *   GET /proxy/2/profile?with=phones      — verified phones list
 *
 * "Who am I?" — useful for an agent to know which account it's operating in,
 * what authentication factors are enabled, and which device(s) are trusted.
 */
import { z } from "zod";

import { ManagerApiClient } from "../api/http.js";

import { defineTool } from "./types.js";

const LanguageSchema = z.object({
  id: z.number(),
  name: z.string(),
  short_name: z.string().optional(),
  locale: z.string(),
  short_locale: z.string().optional(),
});

const CountrySchema = z.object({
  id: z.number(),
  name: z.string(),
  short_name: z.string(),
  is_enabled: z.boolean().optional(),
});

const TimezoneSchema = z.object({
  id: z.number(),
  name: z.string(),
  gmt: z.string().optional(),
});

const AuthDeviceSchema = z.object({
  id: z.number(),
  name: z.string(),
  last_connexion: z.number().optional(),
  user_agent: z.string().optional(),
  user_ip: z.string().optional(),
  device: z.string().optional(),
  created_at: z.number().optional(),
  updated_at: z.number().optional(),
  deleted_at: z.number().nullable().optional(),
});

const SecuritySchema = z.object({
  /** Score 0-5, 5 = maximum protection. */
  score: z.number(),
  has_recovery_email: z.boolean(),
  has_valid_phone: z.boolean(),
  email_validated_at: z.number().optional(),
  otp: z.boolean(),
  sms: z.boolean(),
  yubikey: z.boolean(),
  infomaniak_application: z.boolean(),
  infomaniak_application_enabled: z.boolean().optional(),
  authenticator: z.boolean(),
  double_auth: z.boolean(),
  double_auth_method: z.string().optional(),
  remaining_rescue_code: z.number().optional(),
  last_login_at: z.number().optional(),
  date_last_changed_password: z.number().optional(),
  auth_devices: z.array(AuthDeviceSchema).optional(),
});

const PhoneSchema = z.object({
  id: z.number(),
  phone: z.string(),
  created_at: z.number().optional(),
  reminder: z.boolean().optional(),
  checked: z.boolean(),
  type: z.string().optional(),
});

const EmailSchema = z.object({
  id: z.number(),
  email: z.string(),
  created_at: z.number().optional(),
  reminder: z.boolean().optional(),
  checked: z.boolean().optional(),
});

const ProfileFullSchema = z.object({
  id: z.number(),
  display_name: z.string(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string(),
  is_sso: z.boolean().optional(),
  avatar: z.string().optional(),
  login: z.string().optional().describe("Internal Infomaniak login (e.g. PR00793)."),
  preferences: z
    .object({
      security: SecuritySchema.optional(),
      account: z
        .object({
          current_account_id: z.number(),
          last_login_at: z.number().optional(),
        })
        .optional(),
      language: LanguageSchema.optional(),
      country: CountrySchema.optional(),
      timezone: TimezoneSchema.optional(),
    })
    .optional(),
  phones: z.array(PhoneSchema).optional(),
  emails: z.array(EmailSchema).optional(),
});

// ---------------------------------------------------------------------------
// get_my_profile
// ---------------------------------------------------------------------------

const GetMyProfileInput = z.object({});

export const getMyProfileTool = defineTool({
  name: "infomaniak_get_my_profile",
  description:
    "Get the identity of the currently-authenticated Infomaniak user: name, email, language, country, timezone, current_account_id (= the organization being managed by default), and the full security posture (2FA status, recovery email, validated phone, trusted devices, last login). Use this first to confirm which user + account the MCP is acting on behalf of. Manager-private — requires SASESSION cookie.",
  inputSchema: GetMyProfileInput,
  outputSchema: ProfileFullSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async () => {
    const client = new ManagerApiClient();
    return await client.request<z.infer<typeof ProfileFullSchema>>("GET", "/proxy/2/profile", {
      query: { with: "security,emails,phones" },
    });
  },
});

// ---------------------------------------------------------------------------
// get_my_security
// ---------------------------------------------------------------------------

const GetMySecurityInput = z.object({});

const SecurityReportSchema = z.object({
  score: z.number(),
  score_max: z.number(),
  twofa_enabled: z.boolean(),
  twofa_method: z.string().optional(),
  has_recovery_email: z.boolean(),
  has_valid_phone: z.boolean(),
  yubikey: z.boolean(),
  authenticator: z.boolean(),
  remaining_rescue_codes: z.number().optional(),
  last_login_at_iso: z.string().optional(),
  password_last_changed_iso: z.string().optional(),
  trusted_devices_count: z.number(),
  trusted_devices: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      device: z.string().optional(),
      last_connexion_iso: z.string().optional(),
      user_ip: z.string().optional(),
    }),
  ),
});

export const getMySecurityTool = defineTool({
  name: "infomaniak_get_my_security",
  description:
    "Security posture report for the current user: 2FA status & method, recovery email, validated phone, Yubikey, remaining rescue codes, last login timestamp, password age, and the list of trusted (auth-paired) devices with their last connection IP and time. Useful as a periodic security review or pre-action sanity check. Manager-private.",
  inputSchema: GetMySecurityInput,
  outputSchema: SecurityReportSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async () => {
    const client = new ManagerApiClient();
    const profile = await client.request<z.infer<typeof ProfileFullSchema>>(
      "GET",
      "/proxy/2/profile",
      { query: { with: "security" } },
    );
    const sec = profile.preferences?.security;
    if (!sec) throw new Error("No security data returned by profile endpoint.");
    return {
      score: sec.score,
      score_max: 5,
      twofa_enabled: sec.double_auth,
      ...(sec.double_auth_method !== undefined && { twofa_method: sec.double_auth_method }),
      has_recovery_email: sec.has_recovery_email,
      has_valid_phone: sec.has_valid_phone,
      yubikey: sec.yubikey,
      authenticator: sec.authenticator,
      ...(sec.remaining_rescue_code !== undefined && {
        remaining_rescue_codes: sec.remaining_rescue_code,
      }),
      ...(sec.last_login_at !== undefined && {
        last_login_at_iso: new Date(sec.last_login_at * 1000).toISOString(),
      }),
      ...(sec.date_last_changed_password !== undefined && {
        password_last_changed_iso: new Date(sec.date_last_changed_password * 1000).toISOString(),
      }),
      trusted_devices_count: sec.auth_devices?.length ?? 0,
      trusted_devices: (sec.auth_devices ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        ...(d.device !== undefined && { device: d.device }),
        ...(d.last_connexion !== undefined && {
          last_connexion_iso: new Date(d.last_connexion * 1000).toISOString(),
        }),
        ...(d.user_ip !== undefined && { user_ip: d.user_ip }),
      })),
    };
  },
});
