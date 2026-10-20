/** Read-only DNS export, comparison and public-resolver checks. */
import { Resolver } from "node:dns/promises";

import { z } from "zod";

import { PublicApiClient } from "../api/http.js";
import { DnsRecordSchema, type DnsRecord } from "../types/infomaniak.js";

import { defineTool } from "./types.js";

const ZoneInput = z.object({ zone: z.string().min(3) });
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
const DesiredRecordSchema = DnsRecordSchema.omit({ id: true, updated_at: true });
type DesiredRecord = z.infer<typeof DesiredRecordSchema>;

async function readRecords(zone: string): Promise<DnsRecord[]> {
  const response = await new PublicApiClient().request<unknown>(
    "GET",
    `/2/zones/${encodeURIComponent(zone)}/records`,
  );
  return z.array(DnsRecordSchema).parse(response);
}

function csvCell(value: string | number | undefined): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

/** Export a zone as structured JSON records or quoted CSV, without filesystem writes. */
export const dnsExportTool = defineTool({
  name: "infomaniak_dns_export",
  description:
    "Export a zone's DNS records as JSON or CSV. Returns the export in the tool response; does not write a file or change the zone.",
  inputSchema: ZoneInput.extend({ format: z.enum(["json", "csv"]).default("json") }),
  outputSchema: z.object({
    zone: z.string(),
    count: z.number(),
    format: z.enum(["json", "csv"]),
    content: z.string(),
  }),
  annotations,
  handler: async (input) => {
    const records = await readRecords(input.zone);
    const columns = ["id", "source", "type", "target", "ttl"] as const;
    const content =
      input.format === "json"
        ? JSON.stringify(records, null, 2)
        : [
            columns.join(","),
            ...records.map((record) => columns.map((key) => csvCell(record[key])).join(",")),
          ].join("\r\n");
    return { zone: input.zone, count: records.length, format: input.format, content };
  },
});

function recordKey(record: DesiredRecord): string {
  const source =
    record.source === "@" ? "." : record.source.toLowerCase().replace(/\.$/, "") || ".";
  return JSON.stringify([source, record.type, record.target]);
}

/** Compare desired records with a live zone; IDs and update timestamps are ignored. */
export const dnsDiffTool = defineTool({
  name: "infomaniak_dns_diff",
  description:
    "Compare a live DNS zone with supplied records. Reports additions, removals and TTL changes without applying them. Target values are compared literally, including TXT quoting and MX priorities.",
  inputSchema: ZoneInput.extend({ records: z.array(DesiredRecordSchema) }),
  outputSchema: z.object({
    zone: z.string(),
    added: z.array(DesiredRecordSchema),
    removed: z.array(DnsRecordSchema),
    ttl_changes: z.array(z.object({ before: DnsRecordSchema, after: DesiredRecordSchema })),
    unchanged: z.number(),
  }),
  annotations,
  handler: async (input) => {
    const remaining = await readRecords(input.zone);
    const added: DesiredRecord[] = [];
    const ttlChanges: Array<{ before: DnsRecord; after: DesiredRecord }> = [];
    const unmatched: DesiredRecord[] = [];
    let unchanged = 0;
    // Consume exact matches first so duplicate records cannot steal each other's TTL match.
    for (const desired of input.records) {
      const index = remaining.findIndex(
        (record) => recordKey(record) === recordKey(desired) && record.ttl === desired.ttl,
      );
      if (index < 0) unmatched.push(desired);
      else {
        remaining.splice(index, 1);
        unchanged++;
      }
    }
    for (const desired of unmatched) {
      const index = remaining.findIndex((record) => recordKey(record) === recordKey(desired));
      if (index < 0) added.push(desired);
      else {
        const before = remaining.splice(index, 1)[0];
        if (before !== undefined) ttlChanges.push({ before, after: desired });
      }
    }
    return { zone: input.zone, added, removed: remaining, ttl_changes: ttlChanges, unchanged };
  },
});

// Two tries: with one, about a fifth of healthy lookups time out and report a false disagreement.
const RESOLVER_TIMEOUT_MS = 3000;
const RESOLVER_TRIES = 2;
const SERVERS = { google: "8.8.8.8", cloudflare: "1.1.1.1", quad9: "9.9.9.9" } as const;
const ResolverName = z.enum(["google", "cloudflare", "quad9"]);
const QueryType = z.enum(["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA", "PTR"]);
const ResolverResult = z.object({
  resolver: ResolverName,
  ip: z.string(),
  answers: z.array(z.string()),
  error: z.string().nullable(),
});

function canonicalAnswer(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.join("")); // TXT chunk order is significant.
  if (typeof value === "string") return value.toLowerCase().replace(/\.$/, "");
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, field]) => [
            key,
            typeof field === "string" && ["exchange", "name"].includes(key)
              ? field.toLowerCase().replace(/\.$/, "")
              : field,
          ]),
      ),
    );
  }
  return String(value);
}

/** Query each selected public resolver directly; any failed lookup prevents agreement. */
export const dnsCheckPropagationTool = defineTool({
  name: "infomaniak_dns_check_propagation",
  description:
    "Query Google, Cloudflare and/or Quad9 directly for a DNS name. Reports answers and errors per resolver. Agreement among queried resolvers does not prove global propagation or correctness against the zone.",
  inputSchema: z.object({
    domain: z
      .string()
      .max(253)
      .regex(/^(?:[\da-z_-]{1,63}\.)+[\da-z_-]{1,63}\.?$/i),
    type: QueryType.default("A"),
    resolvers: z
      .array(ResolverName)
      .min(1)
      .max(3)
      .refine((names) => new Set(names).size === names.length, "Choose each resolver once")
      .default(["google", "cloudflare", "quad9"]),
  }),
  outputSchema: z.object({
    domain: z.string(),
    type: QueryType,
    agree: z.boolean(),
    results: z.array(ResolverResult),
  }),
  annotations,
  handler: async (input) => {
    const results = await Promise.all(
      input.resolvers.map(async (name) => {
        const resolver = new Resolver({ timeout: RESOLVER_TIMEOUT_MS, tries: RESOLVER_TRIES });
        resolver.setServers([SERVERS[name]]);
        try {
          const records: unknown = await resolver.resolve(input.domain, input.type);
          if (!Array.isArray(records)) throw new Error("Unexpected DNS response");
          const answers = [...new Set(records.map(canonicalAnswer))].sort();
          return {
            resolver: name,
            ip: SERVERS[name],
            answers,
            error: answers.length > 0 ? null : "No answer",
          };
        } catch (error) {
          return {
            resolver: name,
            ip: SERVERS[name],
            answers: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
    const first = JSON.stringify(results[0]?.answers);
    const agree = results.every(
      (result) => result.error === null && JSON.stringify(result.answers) === first,
    );
    return { domain: input.domain, type: input.type, agree, results };
  },
});
