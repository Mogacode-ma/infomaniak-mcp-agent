/**
 * MCP server entry point — stdio transport.
 *
 * Run with: `npm run dev` (watch) or `npm start` (compiled).
 * Test interactively with: `npm run inspector`.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { InfomaniakError } from "./api/errors.js";
import { loadConfig } from "./config.js";
import { tools } from "./tools/index.js";
import { logger } from "./utils/logger.js";

const PACKAGE_NAME = "infomaniak-mcp-agent";
const PACKAGE_VERSION = "0.1.0";

/**
 * Boots the MCP server.
 *
 * Validates configuration, registers every tool from the registry, and
 * starts the stdio transport. Logs go to stderr only (stdout is reserved
 * for JSON-RPC framing).
 */
async function main(): Promise<void> {
  // Fail fast on bad config.
  loadConfig();

  const server = new Server(
    { name: PACKAGE_NAME, version: PACKAGE_VERSION },
    { capabilities: { tools: {} } },
  );

  // List tools.
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.inputSchema as z.ZodTypeAny, { target: "openApi3" }),
      ...(tool.outputSchema && {
        outputSchema: zodToJsonSchema(tool.outputSchema as z.ZodTypeAny, { target: "openApi3" }),
      }),
      annotations: tool.annotations,
    })),
  }));

  // Dispatch tool calls.
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((t) => t.name === request.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Unknown tool: ${request.params.name}` }],
      };
    }

    try {
      const parsed = tool.inputSchema.parse(request.params.arguments ?? {});
      const result = await tool.handler(parsed);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as Record<string, unknown>,
      };
    } catch (err) {
      if (err instanceof InfomaniakError) {
        return err.toToolError();
      }
      logger.error({ err, tool: tool.name }, "Tool handler error");
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        isError: true,
        content: [{ type: "text" as const, text: `❌ ${message}` }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info({ tools: tools.length }, `${PACKAGE_NAME} v${PACKAGE_VERSION} ready`);
}

try {
  await main();
} catch (err: unknown) {
  logger.fatal({ err }, "Fatal startup error");
  process.exit(1);
}
