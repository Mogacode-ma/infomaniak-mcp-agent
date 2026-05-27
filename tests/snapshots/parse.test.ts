/**
 * Snapshot regression tests — guard against schema-parsing regressions.
 *
 * For each captured production response in `tests/snapshots/responses/`,
 * verify it still parses through the tool's declared output schema.
 *
 * Background: in v0.9 three tools (list_mailboxes, list_databases,
 * get_certificate) shipped with Zod schemas that diverged from the real
 * Infomaniak API responses. The bugs were invisible to unit tests
 * because they were mocked, and only surfaced on the first live smoke.
 * These snapshots are the live captures from that smoke (example.com / 17
 * Mogacode accounts). They lock the contract: any future schema change
 * that would have made those tools throw will now break CI here.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { tools } from "../../src/tools/index.js";

interface SnapshotFile {
  args: Record<string, unknown>;
  result: {
    result?: {
      content?: ReadonlyArray<{ type: string; text?: string }>;
      structuredContent?: unknown;
    };
    error?: { message?: string };
  };
}

const SNAPSHOT_DIR = join(__dirname, "responses");

function loadSnapshots(): Array<{ name: string; tool: string; data: SnapshotFile }> {
  const files = readdirSync(SNAPSHOT_DIR).filter((f) => f.endsWith(".json"));
  return files.map((f) => {
    const [tool] = f.split("__");
    return {
      name: f,
      tool: tool ?? "",
      data: JSON.parse(readFileSync(join(SNAPSHOT_DIR, f), "utf8")) as SnapshotFile,
    };
  });
}

describe("snapshot parse regression", () => {
  const snapshots = loadSnapshots();

  // Tools that were either retired in v0.10 (consolidated) or that snapshot
  // captured an error path (e.g. wrong-arg invocation): they have no schema
  // to validate against today.
  const RETIRED = new Set([
    "infomaniak_dnssec_check",
    "infomaniak_dnssec_enable",
    "infomaniak_dnssec_disable",
    "infomaniak_get_mailbox_aliases",
    "infomaniak_get_mailbox_signatures",
    "infomaniak_get_mailbox_backups",
  ]);

  it("captured at least 30 live responses", () => {
    expect(snapshots.length).toBeGreaterThan(30);
  });

  for (const snap of snapshots) {
    const tool = tools.find((t) => t.name === snap.tool);

    if (!tool) {
      // Tool was consolidated or removed — skip silently.
      if (RETIRED.has(snap.tool)) continue;
      // Unknown tool name — that's a snapshot we can't validate; flag it but don't fail.
      it.skip(`${snap.name} — tool not found`, () => undefined);
      continue;
    }

    it(`${snap.tool}: response parses through declared output schema`, () => {
      const content = snap.data.result.result?.content ?? [];
      const textItem = content.find((c) => c.type === "text" && typeof c.text === "string");
      if (!textItem?.text) return; // empty or non-text response

      const txt = textItem.text;
      // Snapshots that captured a Zod error or API error — those are documented
      // *bad-input* responses, not parse-target shapes.
      if (txt.startsWith("❌")) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(txt);
      } catch {
        return; // text response, not JSON — nothing to validate
      }

      // Try to parse through outputSchema. If it throws, the schema has
      // regressed relative to the live API.
      const result = tool.outputSchema.safeParse(parsed);
      if (!result.success) {
        const issues = result.error.issues
          .slice(0, 3)
          .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
          .join("\n");
        throw new Error(`Output schema rejects live response.\nFirst issues:\n${issues}`);
      }
    });
  }
});
