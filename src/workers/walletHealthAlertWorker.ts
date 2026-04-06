import { OperatorAlertService } from "../services/operatorAlertService.js";
import { WalletHealthService } from "../services/walletHealthService.js";

export class WalletHealthAlertWorker {
  public constructor(
    private readonly walletHealthService: WalletHealthService,
    private readonly operatorAlertService: OperatorAlertService,
    private readonly staleScanAlertMs: number
  ) {}

  public async runOnce(now = new Date()): Promise<void> {
    const health = await this.walletHealthService.getHealth();

    if (!health.walletRpcReachable) {
      await this.operatorAlertService.notifyWalletRpcUnreachable();
    }

    if (health.daemonSynchronized === false) {
      await this.operatorAlertService.notifyDaemonUnsynchronized(
        health.daemonHeight,
        health.daemonTargetHeight
      );
    }

    if (health.pendingOrderCount <= 0) {
      return;
    }

    const lastSuccessfulScanAt = health.lastSuccessfulScanAt ? new Date(health.lastSuccessfulScanAt) : null;
    const stale =
      !lastSuccessfulScanAt ||
      now.getTime() - lastSuccessfulScanAt.getTime() > this.staleScanAlertMs;

    if (stale) {
      await this.operatorAlertService.notifyWalletScanStale(
        health.lastSuccessfulScanAt,
        health.pendingOrderCount
      );
    }
  }
}
