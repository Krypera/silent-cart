import type { MonerodRpcClient } from "../monero/daemonRpcClient.js";
import type { MoneroPaymentAdapter } from "../monero/types.js";
import type { SilentCartStore } from "../repositories/store.js";

export class WalletHealthService {
  public constructor(
    private readonly store: SilentCartStore,
    private readonly moneroAdapter: MoneroPaymentAdapter,
    private readonly monerodClient: MonerodRpcClient | null
  ) {}

  public async getHealth(): Promise<{
    walletRpcReachable: boolean;
    walletHeight: number | null;
    daemonHeight: number | null;
    daemonTargetHeight: number | null;
    daemonSynchronized: boolean | null;
    lastSuccessfulScanAt: string | null;
    pendingOrderCount: number;
    underpaidOrderCount: number;
    recentDetectionActivity: Array<{ txHash: string; orderId: string; confirmations: number }>;
  }> {
    let walletRpcReachable = true;
    let walletHeight: number | null = null;
    let daemonHeight: number | null = null;
    let daemonTargetHeight: number | null = null;
    let daemonSynchronized: boolean | null = null;

    try {
      walletHeight = (await this.moneroAdapter.getWalletHeight()).height;
      await this.moneroAdapter.getVersion();
    } catch {
      walletRpcReachable = false;
    }

    if (this.monerodClient) {
      try {
        const daemonInfo = await this.monerodClient.getInfo();
        daemonHeight = daemonInfo.height;
        daemonTargetHeight = daemonInfo.targetHeight;
        daemonSynchronized = daemonInfo.synchronized;
      } catch {
        daemonHeight = null;
        daemonTargetHeight = null;
        daemonSynchronized = null;
      }
    }

    const [lastScan, pendingOrderCount, underpaidOrderCount, recentActivity] = await Promise.all([
      this.store.settings.get<{ lastSuccessfulScanAt: string }>("wallet.last_scan_at"),
      this.store.orders.countOpenOrders(),
      this.store.orders.countByState("underpaid"),
      this.store.payments.listRecent(5)
    ]);

    return {
      walletRpcReachable,
      walletHeight,
      daemonHeight,
      daemonTargetHeight,
      daemonSynchronized,
      lastSuccessfulScanAt: lastScan?.lastSuccessfulScanAt ?? null,
      pendingOrderCount,
      underpaidOrderCount,
      recentDetectionActivity: recentActivity.map((payment) => ({
        txHash: payment.txHash,
        orderId: payment.orderId,
        confirmations: payment.confirmations
      }))
    };
  }
}
