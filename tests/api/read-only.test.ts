import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InfomaniakError } from "../../src/api/errors.js";
import { PublicApiClient } from "../../src/api/http.js";
import { _resetConfigCache } from "../../src/config.js";

describe("INFOMANIAK_READ_ONLY", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env["INFOMANIAK_API_TOKEN"] = "x".repeat(40);
    process.env["INFOMANIAK_READ_ONLY"] = "1";
    _resetConfigCache();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ result: "success", data: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    delete process.env["INFOMANIAK_READ_ONLY"];
    _resetConfigCache();
    vi.unstubAllGlobals();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"] as const)(
    "refuses %s before any request",
    async (method) => {
      const client = new PublicApiClient();

      const error = await client.request(method, "/1/anything").catch((err: unknown) => err);

      expect(error).toBeInstanceOf(InfomaniakError);
      expect((error as InfomaniakError).code).toBe("read_only_mode");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("still allows GET", async () => {
    const client = new PublicApiClient();

    await expect(client.request("GET", "/1/products")).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("allows writes when the variable is unset", async () => {
    delete process.env["INFOMANIAK_READ_ONLY"];
    _resetConfigCache();
    const client = new PublicApiClient();

    await client.request("POST", "/1/anything", { body: {} });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
