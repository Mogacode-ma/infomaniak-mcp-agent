/**
 * Central registry of every tool exposed by the MCP server.
 *
 * Adding a new tool: import it here and append to the `tools` array.
 * The server iterates this array at startup to register everything.
 */
import { listHostingsTool } from "./hostings.js";
import { listOrganizationsTool } from "./organizations.js";
import { overviewTool } from "./overview.js";
import { createSiteTool, listSitesTool } from "./sites.js";
import type { ToolDefinition } from "./types.js";

export const tools: ReadonlyArray<ToolDefinition> = [
  overviewTool,
  listOrganizationsTool,
  listHostingsTool,
  listSitesTool,
  createSiteTool,
];

export type { ToolDefinition } from "./types.js";
