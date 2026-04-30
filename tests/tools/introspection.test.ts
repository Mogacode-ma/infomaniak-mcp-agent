import { describe, expect, it } from "vitest";

import { tools } from "../../src/tools/index.js";
import { explainTool, helpTool } from "../../src/tools/introspection.js";

describe("infomaniak_help", () => {
  it("returns suggestions matching the intent", async () => {
    const result = (await helpTool.handler({ intent: "create site", limit: 3 })) as {
      suggestions: Array<{ tool: string; score: number }>;
    };
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions[0]?.tool).toMatch(/create_site|sites?/);
  });

  it("returns no suggestions for a totally unrelated intent", async () => {
    const result = (await helpTool.handler({
      intent: "zzzz nonsense xyzzz",
      limit: 5,
    })) as { suggestions: ReadonlyArray<unknown> };
    expect(result.suggestions).toHaveLength(0);
  });

  it("respects the limit parameter", async () => {
    const result = (await helpTool.handler({ intent: "list", limit: 2 })) as {
      suggestions: ReadonlyArray<unknown>;
    };
    expect(result.suggestions.length).toBeLessThanOrEqual(2);
  });
});

describe("infomaniak_explain", () => {
  it("returns the full definition of a known tool", async () => {
    const result = (await explainTool.handler({ tool: "infomaniak_overview" })) as {
      tool: string;
      description: string;
      input_schema: Record<string, unknown>;
    };
    expect(result.tool).toBe("infomaniak_overview");
    expect(result.description.length).toBeGreaterThan(10);
    expect(typeof result.input_schema).toBe("object");
  });

  it("throws a helpful error for unknown tools", async () => {
    await expect(explainTool.handler({ tool: "infomaniak_does_not_exist" })).rejects.toThrow(
      /Unknown tool/i,
    );
  });

  it("can explain every registered tool", async () => {
    for (const tool of tools) {
      const explained = (await explainTool.handler({ tool: tool.name })) as { tool: string };
      expect(explained.tool).toBe(tool.name);
    }
  });
});
