/**
 * Deep kDrive introspection — drive users, trash, full drive detail.
 *
 * Endpoints (manager-private, /proxy/2/ — proxy version 2, not 1):
 *   GET /proxy/2/drive/{id}         — full drive detail (id, name, size, used_size, maintenance)
 *   GET /proxy/2/drive/{id}/files   — root files + dirs (paginated)
 *   GET /proxy/2/drive/{id}/trash   — trashed items
 *   GET /proxy/2/drive/{id}/users   — users with access to the drive
 *
 * Complements the existing `infomaniak_list_drives` + `infomaniak_list_drive_files`
 * (which hit the public Bearer API) with the manager-side rich data.
 */
import { z } from "zod";

import { ManagerApiClient } from "../api/http.js";

import { defineTool } from "./types.js";

// ---------------------------------------------------------------------------
// get_drive_full
// ---------------------------------------------------------------------------

const DriveFullSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    /** Total capacity in bytes. */
    size: z.number(),
    /** Bytes currently used. */
    used_size: z.number(),
    created_at: z.number(),
    updated_at: z.number().optional(),
    in_maintenance: z.boolean().optional(),
    maintenance_at: z.number().nullable().optional(),
  })
  .passthrough();

const GetDriveFullInput = z.object({
  drive_id: z.number().int().positive().describe("kDrive id. Discover via infomaniak_list_drives."),
});

export const getDriveFullTool = defineTool({
  name: "infomaniak_get_drive_full",
  description:
    "Full kDrive detail: name, total size (bytes), used size, creation/update timestamps, maintenance flag. Useful for storage usage monitoring. Manager-private — distinct from the existing `infomaniak_list_drives` which hits the public Bearer API.",
  inputSchema: GetDriveFullInput,
  outputSchema: DriveFullSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const client = new ManagerApiClient();
    return await client.request<z.infer<typeof DriveFullSchema>>(
      "GET",
      `/proxy/2/drive/${input.drive_id}`,
    );
  },
});

// ---------------------------------------------------------------------------
// list_drive_users
// ---------------------------------------------------------------------------

const DriveUserSchema = z.object({
  id: z.number(),
  display_name: z.string(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string(),
  avatar: z.string().optional(),
  is_sso: z.boolean().optional(),
});

const ListDriveUsersInput = z.object({
  drive_id: z.number().int().positive(),
});

const ListDriveUsersOutput = z.object({
  drive_id: z.number(),
  count: z.number(),
  users: z.array(DriveUserSchema),
});

export const listDriveUsersTool = defineTool({
  name: "infomaniak_list_drive_users",
  description:
    "List the users with access to a kDrive. Useful for access audits — who can touch what's in this drive. Manager-private.",
  inputSchema: ListDriveUsersInput,
  outputSchema: ListDriveUsersOutput,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const client = new ManagerApiClient();
    const users = await client.request<z.infer<typeof DriveUserSchema>[]>(
      "GET",
      `/proxy/2/drive/${input.drive_id}/users`,
    );
    return {
      drive_id: input.drive_id,
      count: users.length,
      users,
    };
  },
});

// ---------------------------------------------------------------------------
// list_drive_trash
// ---------------------------------------------------------------------------

const TrashItemSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    type: z.string().describe('"dir" | "file"'),
    status: z.string().optional(),
    visibility: z.string().optional(),
    drive_id: z.number(),
    depth: z.number().optional(),
    created_by: z.number().nullable().optional(),
    created_at: z.number().nullable().optional(),
    added_at: z.number().optional(),
    last_modified_at: z.number().optional(),
    deleted_at: z.number().optional(),
  })
  .passthrough();

const ListDriveTrashInput = z.object({
  drive_id: z.number().int().positive(),
});

const ListDriveTrashOutput = z.object({
  drive_id: z.number(),
  count: z.number(),
  items: z.array(TrashItemSchema),
});

export const listDriveTrashTool = defineTool({
  name: "infomaniak_list_drive_trash",
  description:
    "List the items currently in the kDrive trash bin (files and folders). Each item shows when it was deleted and when added to the drive. Use this to audit what's pending hard-deletion. Manager-private.",
  inputSchema: ListDriveTrashInput,
  outputSchema: ListDriveTrashOutput,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const client = new ManagerApiClient();
    const items = await client.request<z.infer<typeof TrashItemSchema>[]>(
      "GET",
      `/proxy/2/drive/${input.drive_id}/trash`,
    );
    return {
      drive_id: input.drive_id,
      count: items.length,
      items,
    };
  },
});
