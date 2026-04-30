/**
 * Central registry of every tool exposed by the MCP server.
 *
 * Adding a new tool: import it here and append to the `tools` array.
 * The server iterates this array at startup to register everything.
 */
import { auditAccountTool } from "./audit.js";
import { getDatabaseTool, listDatabasesTool } from "./databases.js";
import {
  dnsCreateRecordTool,
  dnsDeleteRecordTool,
  dnsListRecordsTool,
  dnsUpdateRecordTool,
} from "./dns.js";
import { getDomainTool, listDomainsTool } from "./domains.js";
import { listHostingsTool } from "./hostings.js";
import { explainTool, helpTool } from "./introspection.js";
import { getMailboxAliasesTool, listMailHostingsTool, listMailboxesTool } from "./mail.js";
import { listOrganizationsTool } from "./organizations.js";
import { overviewTool } from "./overview.js";
import { historyTool, undoTool } from "./session.js";
import { createSiteTool, deleteSiteTool, listSitesTool } from "./sites.js";
import type { ToolDefinition } from "./types.js";

export const tools: ReadonlyArray<ToolDefinition> = [
  // Introspection (agent-friendly entry points)
  overviewTool,
  helpTool,
  explainTool,
  auditAccountTool,
  historyTool,
  undoTool,
  // Organizations & products
  listOrganizationsTool,
  listHostingsTool,
  listDomainsTool,
  getDomainTool,
  // Web hosting sites
  listSitesTool,
  createSiteTool,
  deleteSiteTool,
  // Databases
  listDatabasesTool,
  getDatabaseTool,
  // DNS
  dnsListRecordsTool,
  dnsCreateRecordTool,
  dnsUpdateRecordTool,
  dnsDeleteRecordTool,
  // Mail
  listMailHostingsTool,
  listMailboxesTool,
  getMailboxAliasesTool,
];

export type { ToolDefinition } from "./types.js";
