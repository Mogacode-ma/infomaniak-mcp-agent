/**
 * Infomaniak AI Tools (sovereign LLM, OpenAI-compatible).
 *
 * Infomaniak runs models on Swiss-sovereign infrastructure with an
 * OpenAI-compatible interface. This module exposes a few read tools so
 * an agent can introspect what's available; chat completions and
 * embeddings can be called via `infomaniak_api_call` (escape hatch) for
 * now. They will get dedicated tools in v0.5 once we settle on the
 * streaming/chunking strategy.
 *
 * Endpoints used:
 *   GET /1/ai          → list of AI products owned by the account
 *   GET /1/ai/models   → public catalogue of available models
 */
import { z } from "zod";

import { PublicApiClient } from "../api/http.js";

import { defineTool } from "./types.js";

const AiProductSchema = z.object({
  id: z.number(),
  name: z.string().optional(),
  service_name: z.string().optional(),
  customer_name: z.string().optional(),
});

const AiModelSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.string().optional(),
  description: z.string().optional(),
  documentation_link: z.string().optional(),
  info_status: z.string().optional(),
  logo_url: z.string().optional(),
});

// ---------------------------------------------------------------------------
// list_ai_products
// ---------------------------------------------------------------------------

const ListAiProductsInput = z.object({});

const ListAiProductsOutput = z.object({
  count: z.number(),
  products: z.array(AiProductSchema),
});

export const listAiProductsTool = defineTool({
  name: "infomaniak_list_ai_products",
  description:
    "List the Infomaniak AI products the account owns. If empty, the user has not subscribed to any AI plan; subscribe at https://www.infomaniak.com/en/hosting/ai-tools.",
  inputSchema: ListAiProductsInput,
  outputSchema: ListAiProductsOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async () => {
    const client = new PublicApiClient();
    const products = await client.request<Array<unknown>>("GET", "/1/ai");
    const parsed = products.map((p) => AiProductSchema.parse(p));
    return { count: parsed.length, products: parsed };
  },
});

// ---------------------------------------------------------------------------
// list_ai_models
// ---------------------------------------------------------------------------

const ListAiModelsInput = z.object({});

const ListAiModelsOutput = z.object({
  count: z.number(),
  models: z.array(AiModelSchema),
});

export const listAiModelsTool = defineTool({
  name: "infomaniak_list_ai_models",
  description:
    "List the public catalogue of LLM/STT/embedding models hosted by Infomaniak (Mixtral, Llama variants, Whisper, …). Useful to know what to target with the OpenAI-compatible chat endpoint.",
  inputSchema: ListAiModelsInput,
  outputSchema: ListAiModelsOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async () => {
    const client = new PublicApiClient();
    const models = await client.request<Array<unknown>>("GET", "/1/ai/models");
    const parsed = models.map((m) => AiModelSchema.parse(m));
    return { count: parsed.length, models: parsed };
  },
});
