import { ExternalServiceError } from "../domain/errors.js";
import type { MonerodInfo } from "./types.js";
import { fetchWithTimeout, isTimeoutError } from "../utils/http.js";

interface MonerodConfig {
  url: string;
  username: string;
  password: string;
  timeoutMs?: number;
}

interface MonerodResponse {
  height: number;
  target_height?: number;
  synchronized?: boolean;
}

export class MonerodRpcClient {
  public constructor(private readonly config: MonerodConfig) {}

  private get timeoutMs() {
    return this.config.timeoutMs ?? 10000;
  }

  public async getInfo(): Promise<MonerodInfo> {
    try {
      const headers = new Headers();

      if (this.config.username || this.config.password) {
        headers.set(
          "authorization",
          `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64")}`
        );
      }

      const response = await fetchWithTimeout(this.config.url, {
        timeoutMs: this.timeoutMs,
        method: "GET",
        headers
      });

      if (!response.ok) {
        throw new ExternalServiceError(`monerod get_info failed with status ${response.status}`);
      }

      const body = (await response.json()) as MonerodResponse;
      return {
        height: body.height,
        targetHeight: body.target_height ?? body.height,
        synchronized: body.synchronized ?? (body.target_height ? body.height >= body.target_height : true)
      };
    } catch (error) {
      if (error instanceof ExternalServiceError) {
        throw error;
      }
      if (isTimeoutError(error)) {
        throw new ExternalServiceError(`monerod get_info timed out after ${this.timeoutMs}ms.`);
      }
      throw new ExternalServiceError(
        error instanceof Error ? `monerod get_info failed: ${error.message}` : "monerod get_info failed."
      );
    }
  }
}
