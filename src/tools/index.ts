/**
 * Central registry of every tool exposed by the MCP server.
 *
 * Adding a new tool: import it here and append to the `tools` array.
 * The server iterates this array at startup to register everything.
 */
import { auditAccountTool } from "./audit.js";
import { dnsCreateRecordTool, dnsDeleteRecordTool, dnsListRecordsTool } from "./dns.js";
import { getDomainTool, listDomainsTool } from "./domains.js";
import { listHostingsTool } from "./hostings.js";
import { explainTool, helpTool } from "./introspection.js";
import { getMailboxAliasesTool, listMailHostingsTool, listMailboxesTool } from "./mail.js";
import { listOrganizationsTool } from "./organizations.js";
import { overviewTool } from "./overview.js";
import { createSiteTool, listSitesTool } from "./sites.js";
import type { ToolDefinition } from "./types.js";

export const tools: ReadonlyArray<ToolDefinition> = [
  // Introspection (agent-friendly entry points)
  overviewTool,
  helpTool,
  explainTool,
  auditAccountTool,
  // Organizations & products
  listOrganizationsTool,
  listHostingsTool,
  listDomainsTool,
  getDomainTool,
  // Web hosting sites
  listSitesTool,
  createSiteTool,
  // DNS
  dnsListRecordsTool,
  dnsCreateRecordTool,
  dnsDeleteRecordTool,
  // Mail
  listMailHostingsTool,
  listMailboxesTool,
  getMailboxAliasesTool,
];

export type { ToolDefinition } from "./types.js";
