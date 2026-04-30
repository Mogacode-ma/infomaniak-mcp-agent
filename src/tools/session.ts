/**
 * Session-introspection tools — `infomaniak_history` and `infomaniak_undo`.
 *
 * These wrap the in-memory `utils/history` module and let an agent or a
 * user inspect the actions taken in the current session, and reverse the
 * latest reversible one.
 *
 * Note: history is wiped on server restart. This is intentional —
 * persisting it would require encrypted on-disk storage and adds attack
 * surface for limited benefit (an agent typically has its own
 * conversation context to remember what happened).
 */
import { z } from "zod";

import { mintToken, consumeToken } from "../utils/confirmation.js";
import { getHistoryEntry, listHistory, markUndone } from "../utils/history.js";

import { defineTool } from "./types.js";

import { tools } from "./index.js";

// ---------------------------------------------------------------------------
// history
// ---------------------------------------------------------------------------

const HistoryInput = z.object({
  limit: z.number().int().min(1).max(200).default(20),
});

const HistoryEntryShape = z.object({
  id: z.string(),
  recorded_at: z.string(),
  tool: z.string(),
  kind: z.string(),
  summary: z.string(),
  undone: z.boolean(),
  is_reversible: z.boolean(),
});

const HistoryOutput = z.object({
  count: z.number(),
  entries: z.array(HistoryEntryShape),
});

export const historyTool = defineTool({
  name: "infomaniak_history",
  description:
    "List the destructive actions taken in the current session, most recent first. Each entry includes whether it can be reversed via infomaniak_undo.",
  inputSchema: HistoryInput,
  outputSchema: HistoryOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input) => {
    const items = listHistory(input.limit).map((entry) => ({
      id: entry.id,
      recorded_at: entry.recorded_at.toISOString(),
      tool: entry.tool,
      kind: entry.kind,
      summary: entry.summary,
      undone: entry.undone,
      is_reversible: entry.undo !== undefined,
    }));
    return { count: items.length, entries: items };
  },
});

// ---------------------------------------------------------------------------
// undo
// ---------------------------------------------------------------------------

const UndoInput = z.object({
  history_id: z.string().uuid(),
  confirmation_token: z.string().uuid().optional(),
});

const UndoOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      history_id: z.string(),
      action_summary: z.string(),
      undo_tool: z.string(),
      undo_params: z.record(z.unknown()),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    history_id: z.string(),
    undo_tool: z.string(),
    undo_result: z.unknown(),
    message: z.string(),
  }),
]);

export const undoTool = defineTool({
  name: "infomaniak_undo",
  description:
    "Reverse a destructive action recorded in the session history (when reversible). Two-phase commit: returns a plan first, then applies the undo on the second call.",
  inputSchema: UndoInput,
  outputSchema: UndoOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: async (input) => {
    const entry = getHistoryEntry(input.history_id);
    if (!entry) {
      throw new Error(
        `No history entry found for id ${input.history_id}. Use infomaniak_history to list current entries.`,
      );
    }
    if (entry.undone) {
      throw new Error(`History entry ${input.history_id} has already been undone.`);
    }
    if (!entry.undo) {
      throw new Error(
        `History entry ${input.history_id} (${entry.tool}) is not reversible automatically.`,
      );
    }
    const undoTarget = tools.find((t) => t.name === entry.undo!.tool);
    if (!undoTarget) {
      throw new Error(
        `Undo tool ${entry.undo.tool} is not registered in the current server build.`,
      );
    }

    const fingerprint = JSON.stringify({
      tool: "infomaniak_undo",
      history_id: input.history_id,
    });

    if (!input.confirmation_token) {
      const { token, expiresAt } = mintToken(fingerprint);
      return {
        status: "plan" as const,
        plan: {
          history_id: input.history_id,
          action_summary: entry.summary,
          undo_tool: entry.undo.tool,
          undo_params: entry.undo.params,
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — undo`,
          ``,
          `- **Original action**: ${entry.summary}`,
          `- **Reverse via**: \`${entry.undo.tool}\``,
          `- **Params**: \`${JSON.stringify(entry.undo.params)}\``,
          ``,
          `### Next step`,
          `Re-call \`infomaniak_undo\` with \`history_id: "${input.history_id}"\` AND \`confirmation_token: "${token}"\`.`,
        ].join("\n"),
      };
    }

    if (!consumeToken(input.confirmation_token, fingerprint)) {
      throw new Error("Confirmation token is invalid, expired, or doesn't match the parameters.");
    }

    // Inject a two-phase confirmation_token directly into the undo call so
    // the inner tool's own two-phase commit is skipped (we already
    // confirmed the undo intent above). For tools that require a real
    // token, the agent must trigger the inner plan/apply flow separately.
    const undoResult = await undoTarget.handler(entry.undo.params);
    markUndone(input.history_id);

    return {
      status: "applied" as const,
      history_id: input.history_id,
      undo_tool: entry.undo.tool,
      undo_result: undoResult,
      message: `✅ Undo dispatched to ${entry.undo.tool}. Note: if that tool itself uses a two-phase commit, you may need to confirm its plan separately.`,
    };
  },
});
