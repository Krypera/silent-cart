import { logger } from "../logger/logger.js";
import type { SilentCartStore } from "../repositories/store.js";
import type { TextMessenger } from "./userNotificationService.js";

interface AlertMarker {
  lastSentAt: string;
}

export class OperatorAlertService {
  public constructor(
    private readonly store: SilentCartStore,
    private readonly messenger: TextMessenger,
    private readonly defaultCooldownMs: number
  ) {}

  public async notifyPaymentScanFailure(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : "unknown_error";
    await this.sendAlert(
      "payment-scan-failed",
      [
        "SilentCart operator alert",
        "",
        "The payment scan worker failed before completing a scan.",
        `Reason: ${message}`
      ],
      this.defaultCooldownMs
    );
  }

  public async notifyPaymentScanPartial(orderFailures: number, scannedOrders: number): Promise<void> {
    await this.sendAlert(
      "payment-scan-partial",
      [
        "SilentCart operator alert",
        "",
        "The payment scan finished, but some orders failed during processing.",
        `Scanned orders: ${scannedOrders}`,
        `Order failures: ${orderFailures}`
      ],
      this.defaultCooldownMs
    );
  }

  public async notifyManualReview(orderId: string, reason: string): Promise<void> {
    const snapshot = await this.store.snapshots.findByOrderId(orderId);
    await this.sendAlert(
      `manual-review:${orderId}`,
      [
        "SilentCart operator alert",
        "",
        `Manual review is required for order ${orderId}.`,
        `Product: ${snapshot?.title ?? "Unknown"}`,
        `Reason: ${reason}`
      ],
      0
    );
  }

  public async notifyWalletRpcUnreachable(): Promise<void> {
    await this.sendAlert(
      "wallet-rpc-unreachable",
      [
        "SilentCart operator alert",
        "",
        "wallet-rpc is currently unreachable.",
        "Payment detection is unhealthy until connectivity is restored."
      ],
      this.defaultCooldownMs
    );
  }

  public async notifyWalletScanStale(lastSuccessfulScanAt: string | null, pendingOrderCount: number): Promise<void> {
    await this.sendAlert(
      "wallet-scan-stale",
      [
        "SilentCart operator alert",
        "",
        "Payment scanning looks stale while pending orders still exist.",
        `Last successful scan: ${lastSuccessfulScanAt ?? "never"}`,
        `Pending orders: ${pendingOrderCount}`
      ],
      this.defaultCooldownMs
    );
  }

  public async notifyDaemonUnsynchronized(
    daemonHeight: number | null,
    daemonTargetHeight: number | null
  ): Promise<void> {
    await this.sendAlert(
      "daemon-unsynchronized",
      [
        "SilentCart operator alert",
        "",
        "The connected monerod does not appear synchronized.",
        `Daemon height: ${daemonHeight ?? "unknown"}`,
        `Daemon target height: ${daemonTargetHeight ?? "unknown"}`
      ],
      this.defaultCooldownMs
    );
  }

  private async sendAlert(key: string, lines: string[], cooldownMs: number): Promise<void> {
    try {
      const markerKey = `alerts.${key}`;
      const marker = await this.store.settings.get<AlertMarker>(markerKey);
      if (marker?.lastSentAt) {
        if (cooldownMs <= 0) {
          return;
        }

        const lastSentAt = new Date(marker.lastSentAt);
        if (Date.now() - lastSentAt.getTime() < cooldownMs) {
          return;
        }
      }

      const admins = await this.store.admins.listAll();
      if (admins.length === 0) {
        return;
      }

      let delivered = false;
      for (const admin of admins) {
        try {
          await this.messenger.sendMessage(admin.telegramUserId, lines.join("\n"));
          delivered = true;
        } catch (error) {
          logger.warn("Failed to deliver operator alert.", {
            key,
            adminTelegramUserId: admin.telegramUserId.toString(),
            error: error instanceof Error ? error.message : "unknown_error"
          });
        }
      }

      if (delivered) {
        await this.store.settings.set(markerKey, {
          lastSentAt: new Date().toISOString()
        });
      }
    } catch (error) {
      logger.warn("Operator alert dispatch failed.", {
        key,
        error: error instanceof Error ? error.message : "unknown_error"
      });
    }
  }
}
