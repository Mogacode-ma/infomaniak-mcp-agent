/**
 * kDrive read-only tools.
 *
 * v0.4 ships listing only. Upload, share-link generation, archive
 * creation and trash management require multipart bodies and chunked
 * uploads — they will land in v0.5 once we have the streaming primitive.
 *
 * Endpoints used (all confirmed live):
 *   GET /2/drive?account_id={id}    → list of drives accessible by account
 *   GET /2/drive/{drive_id}/files   → top-level files / folders
 *   GET /2/drive/{drive_id}         → drive details (quota, users count, …)
 */
import { z } from "zod";

import { PublicApiClient } from "../api/http.js";

import { defineTool } from "./types.js";

const DriveSchema = z.object({
  id: z.number(),
  name: z.string(),
  size: z.number().optional(),
  used_size: z.number().optional(),
  users_count: z.number().optional(),
  users_quota: z.number().optional(),
  in_maintenance: z.boolean().optional(),
  product_id: z.number().optional(),
  account_id: z.number().optional(),
});

const DriveFileSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.string(),
  status: z.string().optional(),
  visibility: z.string().optional(),
  drive_id: z.number().optional(),
  depth: z.number().optional(),
  parent_id: z.number().nullable().optional(),
  created_by: z.number().nullable().optional(),
  created_at: z.number().optional(),
  added_at: z.number().optional(),
  last_modified_at: z.number().optional(),
  color: z.string().nullable().optional(),
});

// ---------------------------------------------------------------------------
// list_drives
// ---------------------------------------------------------------------------

const ListDrivesInput = z.object({
  account_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Organization/account ID. Optional: defaults to the first account the token has access to. Discover via infomaniak_overview.",
    ),
});

const ListDrivesOutput = z.object({
  account_id: z.number(),
  count: z.number(),
  drives: z.array(DriveSchema),
});

export const listDrivesTool = defineTool({
  name: "infomaniak_list_drives",
  description: "List every kDrive the account has access to.",
  inputSchema: ListDrivesInput,
  outputSchema: ListDrivesOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input) => {
    const { defaultAccountId } = await import("../utils/accounts.js");
    const accountId = input.account_id ?? (await defaultAccountId());
    if (accountId === null) {
      throw new Error(
        "No account_id provided and the token reaches no accounts. Use infomaniak_overview to list available accounts.",
      );
    }
    const client = new PublicApiClient();
    const drives = await client.request<Array<unknown>>("GET", `/2/drive`, {
      query: { account_id: accountId },
    });
    const parsed = drives.map((d) => DriveSchema.parse(d));
    return {
      account_id: accountId,
      count: parsed.length,
      drives: parsed,
    };
  },
});

// ---------------------------------------------------------------------------
// list_drive_files
// ---------------------------------------------------------------------------

const ListDriveFilesInput = z.object({
  drive_id: z.number().int().positive(),
  parent_id: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Folder id to list inside. Omit to list the drive's root."),
  per_page: z.number().int().min(1).max(200).default(50),
  page: z.number().int().min(1).default(1),
});

const ListDriveFilesOutput = z.object({
  drive_id: z.number(),
  page: z.number(),
  per_page: z.number(),
  count: z.number(),
  files: z.array(DriveFileSchema),
});

export const listDriveFilesTool = defineTool({
  name: "infomaniak_list_drive_files",
  description:
    "List files and subfolders of a kDrive root or a specific folder. Supports pagination.",
  inputSchema: ListDriveFilesInput,
  outputSchema: ListDriveFilesOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input) => {
    const client = new PublicApiClient();
    const path =
      input.parent_id !== undefined
        ? `/2/drive/${input.drive_id}/files/${input.parent_id}/files`
        : `/2/drive/${input.drive_id}/files`;
    const files = await client.request<Array<unknown>>("GET", path, {
      query: { page: input.page, per_page: input.per_page },
    });
    const parsed = files.map((f) => DriveFileSchema.parse(f));
    return {
      drive_id: input.drive_id,
      page: input.page,
      per_page: input.per_page,
      count: parsed.length,
      files: parsed,
    };
  },
});
