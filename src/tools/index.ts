/**
 * Central registry of every tool exposed by the MCP server.
 *
 * Adding a new tool: import it here and append to the `tools` array.
 * The server iterates this array at startup to register everything.
 */
import { getAccountFullTool, listTeamsAndTagsTool } from "./account-deep.js";
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
import { manageDnssecTool } from "./dnssec.js";
import { getDomainFullTool } from "./domain-deep.js";
import { getDomainTool, listDomainsTool } from "./domains.js";
import { getDriveFullTool, listDriveTrashTool, listDriveUsersTool } from "./drive-deep.js";
import { listDriveFilesTool, listDrivesTool } from "./drive.js";
import { findSiteTool } from "./find-site.js";
import { createHostingUserTool, deleteHostingUserTool, listHostingUsersTool } from "./ftp-users.js";
import { listHostingsTool } from "./hostings.js";
import { explainTool, helpTool } from "./introspection.js";
import { getMailHostingFullTool, getMailboxFullTool } from "./mail-deep.js";
import { getMailboxInfoTool } from "./mail-extras.js";
import { createAliasTool, createMailboxTool, deleteMailboxTool } from "./mail-write.js";
import { listMailHostingsTool, listMailboxesTool } from "./mail.js";
import {
  getNodejsAppTool,
  listNodejsAppsTool,
  nodejsAppActionTool,
  nodejsAppAliasesTool,
  nodejsAppJobsTool,
  nodejsAppLogsTool,
  nodejsAppStatusTool,
  nodejsAppThumbnailTool,
} from "./nodejs.js";
import { listOrganizationsTool } from "./organizations.js";
import { overviewTool } from "./overview.js";
import { getMyProfileTool, getMySecurityTool } from "./profile.js";
import {
  createRedirectionTool,
  deleteRedirectionTool,
  listRedirectionsTool,
} from "./redirections.js";
import { historyTool, undoTool } from "./session.js";
import { addSiteAliasesTool, deleteSiteAliasTool, listSiteAliasesTool } from "./site-aliases.js";
import { createSiteTool, deleteSiteTool, listSitesTool } from "./sites.js";
import { deleteCertificateTool, getCertificateTool, requestCertificateTool } from "./ssl.js";
import { listSwissBackupsTool } from "./swiss-backup.js";
import type { ToolDefinition } from "./types.js";
import { createShortUrlTool, listShortUrlsTool, shortUrlsQuotaTool } from "./url-shortener.js";
import { getVpsFullTool, listVpsTool } from "./vps.js";
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
  // Identity ("who am I?")
  getMyProfileTool,
  getMySecurityTool,
  // Workflows
  provisionSiteFullTool,
  // Organizations & products
  listOrganizationsTool,
  getAccountFullTool,
  listTeamsAndTagsTool,
  listHostingsTool,
  listDomainsTool,
  getDomainTool,
  getDomainFullTool,
  // Web hosting sites
  findSiteTool,
  listSitesTool,
  createSiteTool,
  deleteSiteTool,
  // Site aliases (multi-FQDN + wildcard support)
  listSiteAliasesTool,
  addSiteAliasesTool,
  deleteSiteAliasTool,
  // SSL certificates
  getCertificateTool,
  requestCertificateTool,
  deleteCertificateTool,
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
  // DNSSEC (unified: check/enable/disable)
  manageDnssecTool,
  // Mail (read)
  listMailHostingsTool,
  listMailboxesTool,
  getMailboxInfoTool,
  getMailHostingFullTool,
  getMailboxFullTool,
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
  getDriveFullTool,
  listDriveUsersTool,
  listDriveTrashTool,
  // AI Tools
  listAiProductsTool,
  listAiModelsTool,
  // VPS (Cloud Server / Jelastic)
  listVpsTool,
  getVpsFullTool,
  // Node.js apps (hosting_3 — manager-private)
  listNodejsAppsTool,
  getNodejsAppTool,
  nodejsAppStatusTool,
  nodejsAppAliasesTool,
  nodejsAppJobsTool,
  nodejsAppLogsTool,
  nodejsAppThumbnailTool,
  nodejsAppActionTool,
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
