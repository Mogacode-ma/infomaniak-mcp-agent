/**
 * Session-scoped action history.
 *
 * Tools that mutate state record what they did here. The history is held
 * in process memory only — it is wiped on server restart by design.
 *
 * The tools `infomaniak_history` and `infomaniak_undo` consume this
 * module to give an agent (or a curious user) a way to introspect the
 * actions taken in the current session and, when the action is reversible,
 * undo them.
 */
import { randomUUID } from "node:crypto";

/** Categories of actions tracked in the history. */
export type ActionKind =
  | "create_site"
  | "delete_site"
  | "create_dns_record"
  | "delete_dns_record"
  | "create_database"
  | "delete_database"
  | "request_certificate"
  | "delete_certificate";

/**
 * Description of how to reverse an action. `undefined` means the action
 * cannot be undone automatically (irreversible by definition or no reverse
 * tool available yet).
 */
export interface UndoSpec {
  /** Tool name to call to reverse this action. */
  tool: string;
  /** Parameters to pass to the undo tool. */
  params: Record<string, unknown>;
  /** Short description shown to the user before they confirm the undo. */
  description: string;
}

export interface HistoryEntry {
  /** Stable id of this entry, returned to callers for `infomaniak_undo`. */
  id: string;
  /** Wall-clock time the action was recorded. */
  recorded_at: Date;
  /** Tool name that produced this entry. */
  tool: string;
  /** Category of the action — handy for filtering. */
  kind: ActionKind;
  /** One-sentence human-readable summary. */
  summary: string;
  /** Sanitized payload of what was sent / received. Never store secrets. */
  payload: Record<string, unknown>;
  /** Optional undo specification. */
  undo: UndoSpec | undefined;
  /** True if the entry has already been undone. */
  undone: boolean;
}

const entries: HistoryEntry[] = [];

/**
 * Cap on the number of entries kept in memory. Beyond this point, the
 * oldest entries are evicted to keep memory usage bounded.
 */
const MAX_ENTRIES = 200;

/**
 * Records a new history entry.
 *
 * @returns The created entry (with its assigned id).
 */
export function recordHistory(input: {
  tool: string;
  kind: ActionKind;
  summary: string;
  payload: Record<string, unknown>;
  undo?: UndoSpec;
}): HistoryEntry {
  const entry: HistoryEntry = {
    id: randomUUID(),
    recorded_at: new Date(),
    tool: input.tool,
    kind: input.kind,
    summary: input.summary,
    payload: input.payload,
    undo: input.undo,
    undone: false,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  return entry;
}

/** Returns the latest entries, most recent first. */
export function listHistory(limit = 50): ReadonlyArray<HistoryEntry> {
  return [...entries].slice(-limit).reverse();
}

/** Looks up a single entry by id. */
export function getHistoryEntry(id: string): HistoryEntry | undefined {
  return entries.find((e) => e.id === id);
}

/** Marks an entry as undone (does NOT remove it; we keep audit trail). */
export function markUndone(id: string): boolean {
  const entry = entries.find((e) => e.id === id);
  if (!entry || entry.undone) {
    return false;
  }
  entry.undone = true;
  return true;
}

/** @internal — for tests only. */
export function _resetHistory(): void {
  entries.length = 0;
}
