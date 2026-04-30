/**
 * Introspection tools — `infomaniak_help` and `infomaniak_explain`.
 *
 * These tools let an agent (or a curious user) ask the MCP itself which
 * tool to call for a given intent, or what a specific tool does. They
 * make the server self-documenting: an agent can come in cold and
 * navigate the toolbox without external documentation.
 */
import { z } from "zod";

import { defineTool } from "./types.js";

import { tools } from "./index.js";

// ---------------------------------------------------------------------------
// help — fuzzy intent → tool suggestions
// ---------------------------------------------------------------------------

const HelpInput = z.object({
  /** Free-form description of what you want to do. */
  intent: z
    .string()
    .min(2)
    .describe("Free-form description of what you want to do, in any language."),
  /** Maximum number of suggestions returned. */
  limit: z.number().int().min(1).max(20).default(5),
});

const SuggestionSchema = z.object({
  tool: z.string(),
  description: z.string(),
  score: z.number(),
  matched_terms: z.array(z.string()),
});

const HelpOutput = z.object({
  intent: z.string(),
  suggestions: z.array(SuggestionSchema),
  next_step_markdown: z.string(),
});

export const helpTool = defineTool({
  name: "infomaniak_help",
  description:
    "Suggest which Infomaniak tools to use for a given intent expressed in natural language. Lightweight keyword matching against tool names and descriptions.",
  inputSchema: HelpInput,
  outputSchema: HelpOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input) => {
    const terms = tokenize(input.intent);
    const suggestions: Array<z.infer<typeof SuggestionSchema>> = [];
    for (const tool of tools) {
      const haystackTokens = new Set([...tokenize(tool.name), ...tokenize(tool.description)]);
      const matched = terms.filter((t) => haystackTokens.has(t));
      if (matched.length > 0) {
        suggestions.push({
          tool: tool.name,
          description: tool.description,
          score: matched.length,
          matched_terms: matched,
        });
      }
    }
    suggestions.sort((a, b) => b.score - a.score);
    const top = suggestions.slice(0, input.limit);
    const md = top.length
      ? [
          `## Suggested tools for "${input.intent}"`,
          ``,
          ...top.map((s) => `- **\`${s.tool}\`** (${s.score} term match): ${s.description}`),
          ``,
          `Use \`infomaniak_explain\` with a tool name to learn its parameters.`,
        ].join("\n")
      : [
          `## No direct matches for "${input.intent}"`,
          ``,
          `Try a more specific term — for example: "create site", "list mailboxes",`,
          `"DNS record", "domain expiration", "audit my account".`,
        ].join("\n");

    return { intent: input.intent, suggestions: top, next_step_markdown: md };
  },
});

// ---------------------------------------------------------------------------
// explain — describe one tool in detail
// ---------------------------------------------------------------------------

const ExplainInput = z.object({
  tool: z.string().min(1).describe("Name of the tool to explain (e.g. 'infomaniak_overview')."),
});

const ExplainOutput = z.object({
  tool: z.string(),
  description: z.string(),
  annotations: z.record(z.boolean()).optional(),
  /** JSON Schema of the input parameters. */
  input_schema: z.record(z.unknown()),
  /** JSON Schema of the output (when defined). */
  output_schema: z.record(z.unknown()).optional(),
});

export const explainTool = defineTool({
  name: "infomaniak_explain",
  description:
    "Returns the full definition of a specific tool — description, annotations, input parameters and output shape.",
  inputSchema: ExplainInput,
  outputSchema: ExplainOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input) => {
    const tool = tools.find((t) => t.name === input.tool);
    if (!tool) {
      const known = tools.map((t) => `\`${t.name}\``).join(", ");
      throw new Error(
        `Unknown tool: ${input.tool}. Known tools: ${known}. Use infomaniak_help for fuzzy lookup.`,
      );
    }
    // Lazily import zod-to-json-schema to avoid loading it on every server start.
    const { zodToJsonSchema } = await import("zod-to-json-schema");
    const inputSchema = zodToJsonSchema(tool.inputSchema, { target: "openApi3" }) as Record<
      string,
      unknown
    >;
    const annotations = tool.annotations
      ? Object.fromEntries(
          Object.entries(tool.annotations).filter(
            (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
          ),
        )
      : undefined;
    const result: z.infer<typeof ExplainOutput> = {
      tool: tool.name,
      description: tool.description,
      input_schema: inputSchema,
      ...(annotations !== undefined ? { annotations } : {}),
    };
    if (tool.outputSchema) {
      result.output_schema = zodToJsonSchema(tool.outputSchema, { target: "openApi3" }) as Record<
        string,
        unknown
      >;
    }
    return result;
  },
});

/** Lowercase + split on non-alpha into a unique set of tokens. */
function tokenize(input: string): string[] {
  const matches = input.toLowerCase().match(/[a-z0-9]+/g);
  if (!matches) {
    return [];
  }
  return [...new Set(matches.filter((token) => token.length > 1))];
}
