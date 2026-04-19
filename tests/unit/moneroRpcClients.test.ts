import { afterEach, describe, expect, it, vi } from "vitest";
import { MonerodRpcClient } from "../../src/monero/daemonRpcClient.js";
import { MoneroWalletRpcClient } from "../../src/monero/walletRpcClient.js";

describe("Monero RPC clients", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("passes an abort signal to wallet-rpc fetch calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      async json() {
        return {
          result: {
            version: 42
          }
        };
      }
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const client = new MoneroWalletRpcClient({
      url: "http://wallet.example/json_rpc",
      username: "",
      password: "",
      accountIndex: 0,
      timeoutMs: 2500
    });

    await expect(client.getVersion()).resolves.toEqual({
      version: 42
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://wallet.example/json_rpc",
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("wraps wallet-rpc timeouts with a clear upstream error", async () => {
    const timeoutError = new Error("request timed out");
    timeoutError.name = "TimeoutError";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(timeoutError) as typeof fetch
    );

    const client = new MoneroWalletRpcClient({
      url: "http://wallet.example/json_rpc",
      username: "",
      password: "",
      accountIndex: 0,
      timeoutMs: 2500
    });

    await expect(client.getVersion()).rejects.toMatchObject({
      code: "external_service_error",
      message: "wallet-rpc request timed out after 2500ms."
    });
  });

  it("wraps monerod timeouts with a clear upstream error", async () => {
    const timeoutError = new Error("request timed out");
    timeoutError.name = "TimeoutError";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(timeoutError) as typeof fetch
    );

    const client = new MonerodRpcClient({
      url: "http://daemon.example/get_info",
      username: "",
      password: "",
      timeoutMs: 4000
    });

    await expect(client.getInfo()).rejects.toMatchObject({
      code: "external_service_error",
      message: "monerod get_info timed out after 4000ms."
    });
  });
});
