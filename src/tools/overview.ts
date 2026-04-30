/**
 * `infomaniak_overview` — agentic onboarding tool.
 *
 * Returns a high-level summary of the user's account: organizations they
 * have access to, products grouped by service, and a few quick stats.
 * Designed to be the first call an agent makes when entering a new session.
 */
import { z } from "zod";

import { PublicApiClient } from "../api/http.js";

import { defineTool } from "./types.js";

const InputSchema = z.object({
  /** Limit the overview to a single account_id (default: all accessible). */
  account_id: z.number().int().positive().optional(),
});

const ServiceSummarySchema = z.object({
  service_name: z.string(),
  count: z.number(),
});

const AccountSummarySchema = z.object({
  account_id: z.number(),
  account_name: z.string(),
  total_products: z.number(),
  by_service: z.array(ServiceSummarySchema),
});

const OutputSchema = z.object({
  total_accounts: z.number(),
  total_products: z.number(),
  accounts: z.array(AccountSummarySchema),
  /** Markdown-formatted human-readable summary. */
  summary_markdown: z.string(),
});

export const overviewTool = defineTool({
  name: "infomaniak_overview",
  description:
    "Returns a summary of all Infomaniak organizations and products you have access to. Best called first in a session.",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const client = new PublicApiClient();
    const accounts = await client.request<Array<{ id: number; name: string }>>("GET", "/1/account");
    const products = await client.request<Array<{ account_id: number; service_name: string }>>(
      "GET",
      "/1/products",
      { query: { per_page: 500 } },
    );

    const filteredProducts = input.account_id
      ? products.filter((p) => p.account_id === input.account_id)
      : products;
    const filteredAccounts = input.account_id
      ? accounts.filter((a) => a.id === input.account_id)
      : accounts;

    const accountSummaries = filteredAccounts.map((account) => {
      const accountProducts = filteredProducts.filter((p) => p.account_id === account.id);
      const counts = new Map<string, number>();
      for (const p of accountProducts) {
        counts.set(p.service_name, (counts.get(p.service_name) ?? 0) + 1);
      }
      return {
        account_id: account.id,
        account_name: account.name,
        total_products: accountProducts.length,
        by_service: [...counts.entries()]
          .map(([service_name, count]) => ({ service_name, count }))
          .sort((a, b) => b.count - a.count),
      };
    });

    const summaryLines: string[] = [
      `# Infomaniak account overview`,
      ``,
      `**${filteredAccounts.length} organization(s) — ${filteredProducts.length} product(s) total**`,
      ``,
    ];
    for (const acc of accountSummaries.sort((a, b) => b.total_products - a.total_products)) {
      summaryLines.push(`## ${acc.account_name} (id ${acc.account_id})`);
      summaryLines.push(`Total: **${acc.total_products}** products`);
      if (acc.by_service.length > 0) {
        summaryLines.push("");
        for (const svc of acc.by_service) {
          summaryLines.push(`- \`${svc.service_name}\`: ${svc.count}`);
        }
      }
      summaryLines.push("");
    }

    return {
      total_accounts: filteredAccounts.length,
      total_products: filteredProducts.length,
      accounts: accountSummaries,
      summary_markdown: summaryLines.join("\n"),
    };
  },
});
