/**
 * Common types for tool definitions.
 *
 * Each tool exports a {@link ToolDefinition} that the server registers
 * with the MCP SDK. Tools are typed end-to-end via Zod input/output
 * schemas, which also produce the JSON Schema served to clients.
 */
import type { z } from "zod";

export interface ToolAnnotations {
  /** Tool does not modify state. */
  readOnlyHint?: boolean | undefined;
  /** Tool may perform destructive updates. */
  destructiveHint?: boolean | undefined;
  /** Repeated calls with same args have no additional effect. */
  idempotentHint?: boolean | undefined;
  /** Tool interacts with external entities. */
  openWorldHint?: boolean | undefined;
}

/**
 * Tool definition, structurally typed (no Zod generics in the contract).
 *
 * We avoid carrying input/output Zod generics in the public contract on
 * purpose: with `exactOptionalPropertyTypes: true`, narrow generics force
 * every entry of a `ToolDefinition[]` to have *identical* schemas, which
 * defeats the purpose of a heterogenous registry. The handler accepts
 * `unknown` and validates internally.
 */
export interface ToolDefinition {
  /** Tool name — must use snake_case with `infomaniak_` prefix. */
  name: string;
  /** Short human-readable description (1-2 sentences max). */
  description: string;
  /** Zod schema for input parameters. */
  inputSchema: z.ZodTypeAny;
  /** Zod schema for output (used for structuredContent). */
  outputSchema?: z.ZodTypeAny | undefined;
  /** Hints for clients about tool behavior. */
  annotations?: ToolAnnotations | undefined;
  /**
   * Handler — receives parsed and validated input, returns the output
   * payload. Errors should be thrown as InfomaniakError or subclasses.
   */
  handler: (input: unknown) => Promise<unknown>;
}

/**
 * Helper to declare a tool with full Zod inference at the call site.
 *
 * Use this in each tool file to keep input/output typing tight while
 * still landing in the structural `ToolDefinition` shape required by the
 * registry.
 */
export function defineTool<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny>(definition: {
  name: string;
  description: string;
  inputSchema: TInput;
  outputSchema?: TOutput;
  annotations?: ToolAnnotations;
  handler: (input: z.infer<TInput>) => Promise<z.infer<TOutput>> | Promise<unknown>;
}): ToolDefinition {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    annotations: definition.annotations,
    handler: async (input: unknown) =>
      (definition.handler as (i: unknown) => Promise<unknown>)(input),
  };
}
