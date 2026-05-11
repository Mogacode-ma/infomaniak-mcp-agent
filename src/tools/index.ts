/**
 * Central registry of every tool exposed by the MCP server.
 *
 * Adding a new tool: import it here and append to the `tools` array.
 * The server iterates this array at startup to register everything.
 */
import { listAiModelsTool, listAiProductsTool } from "./ai.js";
import { apiCallTool } from "./api-call.js";
import { auditAccountTool } from "./audit.js";
import {
  createDatabaseTool,
  deleteDatabaseTool,
  getDatabaseTool,
  getDatabaseUserTool,
  listDatabaseUsersTool,
  listDatabasesTool,
} from "./databases.js";
import {
  dnsCreateRecordTool,
  dnsDeleteRecordTool,
  dnsListRecordsTool,
  dnsUpdateRecordTool,
} from "./dns.js";
import { dnssecCheckTool, dnssecDisableTool, dnssecEnableTool } from "./dnssec.js";
import { getDomainTool, listDomainsTool } from "./domains.js";
import { listDriveFilesTool, listDrivesTool } from "./drive.js";
import { createHostingUserTool, deleteHostingUserTool, listHostingUsersTool } from "./ftp-users.js";
import { listHostingsTool } from "./hostings.js";
import { explainTool, helpTool } from "./introspection.js";
import { getMailboxBackupsTool, getMailboxSignaturesTool } from "./mail-extras.js";
import { createAliasTool, createMailboxTool, deleteMailboxTool } from "./mail-write.js";
import { getMailboxAliasesTool, listMailHostingsTool, listMailboxesTool } from "./mail.js";
import { listOrganizationsTool } from "./organizations.js";
import { overviewTool } from "./overview.js";
import {
  createRedirectionTool,
  deleteRedirectionTool,
  listRedirectionsTool,
} from "./redirections.js";
import { historyTool, undoTool } from "./session.js";
import { createSiteTool, deleteSiteTool, listSitesTool } from "./sites.js";
import { listSwissBackupsTool } from "./swiss-backup.js";
import type { ToolDefinition } from "./types.js";
import { createShortUrlTool, listShortUrlsTool, shortUrlsQuotaTool } from "./url-shortener.js";
import { auditDnsZonesTool, provisionSiteFullTool } from "./workflows.js";

export const tools: ReadonlyArray<ToolDefinition> = [
  // Introspection (agent-friendly entry points)
  overviewTool,
  helpTool,
  explainTool,
  auditAccountTool,
  auditDnsZonesTool,
  historyTool,
  undoTool,
  // Workflows
  provisionSiteFullTool,
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
  createDatabaseTool,
  deleteDatabaseTool,
  listDatabaseUsersTool,
  getDatabaseUserTool,
  // FTP / SSH users
  listHostingUsersTool,
  createHostingUserTool,
  deleteHostingUserTool,
  // DNS
  dnsListRecordsTool,
  dnsCreateRecordTool,
  dnsUpdateRecordTool,
  dnsDeleteRecordTool,
  // DNSSEC
  dnssecCheckTool,
  dnssecEnableTool,
  dnssecDisableTool,
  // Mail (read)
  listMailHostingsTool,
  listMailboxesTool,
  getMailboxAliasesTool,
  getMailboxSignaturesTool,
  getMailboxBackupsTool,
  // Mail (write)
  createMailboxTool,
  deleteMailboxTool,
  createAliasTool,
  // Mail redirections
  listRedirectionsTool,
  createRedirectionTool,
  deleteRedirectionTool,
  // kDrive
  listDrivesTool,
  listDriveFilesTool,
  // AI Tools
  listAiProductsTool,
  listAiModelsTool,
  // Swiss Backup
  listSwissBackupsTool,
  // URL Shortener
  listShortUrlsTool,
  shortUrlsQuotaTool,
  createShortUrlTool,
  // Escape hatch
  apiCallTool,
];

export type { ToolDefinition } from "./types.js";
