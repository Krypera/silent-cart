import { ExternalServiceError } from "../domain/errors.js";
import type {
  MoneroPaymentAdapter,
  MoneroTransfer,
  SubaddressAllocation,
  WalletHeightInfo,
  WalletVersionInfo
} from "./types.js";
import { fetchWithTimeout, isTimeoutError } from "../utils/http.js";

interface WalletRpcConfig {
  url: string;
  username: string;
  password: string;
  accountIndex: number;
  timeoutMs?: number;
}

interface JsonRpcEnvelope<T> {
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

interface WalletTransferItem {
  txid: string;
  amount: string | number;
  confirmations: number;
  address: string;
  timestamp: number;
  subaddr_index: {
    major: number;
    minor: number;
  };
}

export class MoneroWalletRpcClient implements MoneroPaymentAdapter {
  public constructor(private readonly config: WalletRpcConfig) {}

  private get timeoutMs() {
    return this.config.timeoutMs ?? 10000;
  }

  public async createSubaddress(label: string): Promise<SubaddressAllocation> {
    const result = await this.callRpc<{
      address: string;
      address_index: number;
    }>("create_address", {
      account_index: this.config.accountIndex,
      label
    });

    return {
      address: result.address,
      accountIndex: this.config.accountIndex,
      subaddressIndex: result.address_index
    };
  }

  public async refresh(): Promise<void> {
    await this.callRpc("refresh", {});
  }

  public async getIncomingTransfers(args: {
    accountIndex: number;
    subaddressIndices: number[];
  }): Promise<MoneroTransfer[]> {
    if (args.subaddressIndices.length === 0) {
      return [];
    }

    const result = await this.callRpc<{
      in?: WalletTransferItem[];
      pending?: WalletTransferItem[];
      pool?: WalletTransferItem[];
    }>("get_transfers", {
      in: true,
      pending: true,
      pool: true,
      account_index: args.accountIndex,
      subaddr_indices: args.subaddressIndices
    });

    const items = [...(result.in ?? []), ...(result.pending ?? []), ...(result.pool ?? [])];

    return items.map((item) => ({
      txHash: item.txid,
      amountAtomic: BigInt(item.amount),
      confirmations: item.confirmations ?? 0,
      accountIndex: item.subaddr_index.major,
      subaddressIndex: item.subaddr_index.minor,
      address: item.address,
      seenAt: new Date(item.timestamp * 1000)
    }));
  }

  public async getWalletHeight(): Promise<WalletHeightInfo> {
    const result = await this.callRpc<{ height: number }>("get_height", {});
    return {
      height: result.height
    };
  }

  public async getVersion(): Promise<WalletVersionInfo> {
    const result = await this.callRpc<{ version: number }>("get_version", {});
    return {
      version: result.version
    };
  }

  private async callRpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    try {
      const headers = new Headers({
        "content-type": "application/json"
      });

      if (this.config.username || this.config.password) {
        headers.set(
          "authorization",
          `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64")}`
        );
      }

      const response = await fetchWithTimeout(this.config.url, {
        timeoutMs: this.timeoutMs,
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "silentcart",
          method,
          params
        })
      });

      if (!response.ok) {
        throw new ExternalServiceError(`wallet-rpc request failed with status ${response.status}`);
      }

      const json = (await response.json()) as JsonRpcEnvelope<T>;
      if (json.error) {
        throw new ExternalServiceError(`wallet-rpc error ${json.error.code}: ${json.error.message}`);
      }

      if (!json.result) {
        throw new ExternalServiceError(`wallet-rpc method ${method} returned no result.`);
      }

      return json.result;
    } catch (error) {
      if (error instanceof ExternalServiceError) {
        throw error;
      }
      if (isTimeoutError(error)) {
        throw new ExternalServiceError(`wallet-rpc request timed out after ${this.timeoutMs}ms.`);
      }
      throw new ExternalServiceError(
        error instanceof Error ? `wallet-rpc request failed: ${error.message}` : "wallet-rpc request failed."
      );
    }
  }
}
