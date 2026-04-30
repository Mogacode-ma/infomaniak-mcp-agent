import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  _resetHistory,
  getHistoryEntry,
  listHistory,
  markUndone,
  recordHistory,
} from "../../src/utils/history.js";

describe("history", () => {
  beforeEach(() => {
    _resetHistory();
  });

  afterEach(() => {
    _resetHistory();
  });

  it("records and retrieves entries by id", () => {
    const entry = recordHistory({
      tool: "infomaniak_create_site",
      kind: "create_site",
      summary: "Created site test.example.com",
      payload: { fqdn: "test.example.com" },
    });
    expect(entry.id).toMatch(/^[\da-f-]{36}$/i);
    const fetched = getHistoryEntry(entry.id);
    expect(fetched?.summary).toBe("Created site test.example.com");
    expect(fetched?.undone).toBe(false);
  });

  it("returns entries newest-first when listed", () => {
    const a = recordHistory({ tool: "t", kind: "create_site", summary: "A", payload: {} });
    const b = recordHistory({ tool: "t", kind: "create_site", summary: "B", payload: {} });
    const list = listHistory(10);
    expect(list[0]?.id).toBe(b.id);
    expect(list[1]?.id).toBe(a.id);
  });

  it("respects the limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      recordHistory({ tool: "t", kind: "create_site", summary: `#${i}`, payload: {} });
    }
    expect(listHistory(2)).toHaveLength(2);
  });

  it("evicts oldest entries beyond MAX_ENTRIES", () => {
    for (let i = 0; i < 250; i++) {
      recordHistory({ tool: "t", kind: "create_site", summary: `#${i}`, payload: {} });
    }
    expect(listHistory(500)).toHaveLength(200);
  });

  it("preserves the undo spec when provided", () => {
    const entry = recordHistory({
      tool: "create_dns_record",
      kind: "create_dns_record",
      summary: "Created A record",
      payload: { id: 1 },
      undo: {
        tool: "infomaniak_dns_delete_record",
        params: { zone: "example.com", record_id: 1 },
        description: "Delete the record",
      },
    });
    expect(entry.undo).toBeDefined();
    expect(entry.undo?.tool).toBe("infomaniak_dns_delete_record");
  });

  it("markUndone flips the flag, returns false on second call", () => {
    const entry = recordHistory({ tool: "t", kind: "create_site", summary: "X", payload: {} });
    expect(markUndone(entry.id)).toBe(true);
    expect(getHistoryEntry(entry.id)?.undone).toBe(true);
    expect(markUndone(entry.id)).toBe(false);
  });

  it("markUndone returns false for unknown ids", () => {
    expect(markUndone("00000000-0000-0000-0000-000000000000")).toBe(false);
  });
});
