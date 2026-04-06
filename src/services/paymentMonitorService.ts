import { randomUUID } from "node:crypto";
import type { MoneroPaymentAdapter, MoneroTransfer } from "../monero/types.js";
import type { Order, PaymentEvent } from "../domain/models.js";
import { logger } from "../logger/logger.js";
import type { SilentCartStore } from "../repositories/store.js";
import { OperatorAlertService } from "./operatorAlertService.js";
import { OrderService } from "./orderService.js";
import { UserNotificationService } from "./userNotificationService.js";

interface PaymentMonitorResult {
  scannedOrders: number;
  newlySeen: number;
  newlyConfirmed: number;
  newlyUnderpaid: number;
  orderFailures: number;
}

interface AggregatedTransfer {
  txHash: string;
  amountAtomic: bigint;
  confirmations: number;
  seenAt: Date;
}

interface ScanOffsets {
  openOffset: number;
  expiredOffset: number;
}

function transferBucketKey(accountIndex: number, subaddressIndex: number): string {
  return `${accountIndex}:${subaddressIndex}`;
}

export class PaymentMonitorService {
  public constructor(
    private readonly store: SilentCartStore,
    private readonly orderService: OrderService,
    private readonly moneroAdapter: MoneroPaymentAdapter,
    private readonly maxOrdersPerScan: number,
    private readonly userNotificationService: UserNotificationService | null = null,
    private readonly operatorAlertService: OperatorAlertService | null = null
  ) {}

  public async scan(now = new Date()): Promise<PaymentMonitorResult> {
    const scanOffsets =
      (await this.store.settings.get<ScanOffsets>("wallet.scan_offsets")) ?? {
        openOffset: 0,
        expiredOffset: 0
      };

    const openWindow = await this.loadScanWindow(
      ["awaiting_payment", "payment_seen"],
      this.maxOrdersPerScan,
      scanOffsets.openOffset
    );
    const expiredWindow = await this.loadScanWindow(
      ["expired"],
      Math.max(10, Math.floor(this.maxOrdersPerScan / 4)),
      scanOffsets.expiredOffset
    );
    const scannedOrders = [...openWindow.orders];
    for (const order of expiredWindow.orders) {
      if (!scannedOrders.some((candidate) => candidate.id === order.id)) {
        scannedOrders.push(order);
      }
    }

    if (scannedOrders.length === 0) {
      return {
        scannedOrders: 0,
        newlySeen: 0,
        newlyConfirmed: 0,
        newlyUnderpaid: 0,
        orderFailures: 0
      };
    }

    await this.moneroAdapter.refresh();

    const groupedIndices = new Map<number, Set<number>>();
    for (const order of scannedOrders) {
      const set = groupedIndices.get(order.accountIndex) ?? new Set<number>();
      set.add(order.subaddressIndex);
      groupedIndices.set(order.accountIndex, set);
    }

    const transfers = new Map<string, AggregatedTransfer[]>();
    for (const [accountIndex, subaddressIndices] of groupedIndices.entries()) {
      const items = await this.moneroAdapter.getIncomingTransfers({
        accountIndex,
        subaddressIndices: [...subaddressIndices]
      });

      for (const [bucketKey, bucket] of this.groupTransfers(items).entries()) {
        transfers.set(bucketKey, bucket);
      }
    }

    let newlySeen = 0;
    let newlyConfirmed = 0;
    let newlyUnderpaid = 0;
    let orderFailures = 0;

    for (const order of scannedOrders) {
      try {
        const orderTransfers =
          transfers.get(transferBucketKey(order.accountIndex, order.subaddressIndex)) ?? [];
        const existingEvents = await this.store.payments.findByOrderId(order.id);

        for (const transfer of orderTransfers) {
          await this.upsertPaymentEvent(
            order.id,
            transfer,
            existingEvents,
            transfer.amountAtomic < order.quotedAmountAtomic ? "underpaid" : "qualifying"
          );
        }

        const decision = this.chooseTransfer(order, orderTransfers, now);
        if (!decision.transfer) {
          if (decision.shouldExpire && order.state === "awaiting_payment") {
            await this.orderService.expireOrder(order.id, now);
            await this.userNotificationService?.notifyExpired(order.id);
          }
          continue;
        }

        let effectiveOrder = order;
        if (effectiveOrder.state === "expired") {
          try {
            effectiveOrder = await this.orderService.reopenExpiredOrder(order.id);
          } catch (error) {
            await this.flagManualReview(order.id, error);
            await this.operatorAlertService?.notifyManualReview(
              order.id,
              error instanceof Error ? error.message : "Manual review is required."
            );
            continue;
          }
        }

        if (decision.kind === "underpaid") {
          await this.orderService.markUnderpaid(
            effectiveOrder.id,
            decision.transfer.txHash,
            decision.transfer.amountAtomic,
            decision.transfer.seenAt
          );
          await this.userNotificationService?.notifyUnderpaid(effectiveOrder.id);
          newlyUnderpaid += 1;
          continue;
        }

        if (effectiveOrder.state === "awaiting_payment") {
          await this.orderService.markPaymentSeen(
            effectiveOrder.id,
            decision.transfer.txHash,
            decision.transfer.amountAtomic,
            decision.transfer.seenAt
          );
          if (decision.transfer.confirmations < 1) {
            await this.userNotificationService?.notifyPaymentSeen(effectiveOrder.id);
          }
          newlySeen += 1;
          effectiveOrder = (await this.store.orders.findById(effectiveOrder.id)) ?? effectiveOrder;
        }

        if (decision.transfer.confirmations >= 1) {
          await this.orderService.markConfirmed(
            effectiveOrder.id,
            decision.transfer.txHash,
            decision.transfer.amountAtomic,
            now,
            decision.transfer.seenAt
          );
          await this.userNotificationService?.notifyPaymentConfirmed(effectiveOrder.id);
          newlyConfirmed += 1;
        }
      } catch (error) {
        orderFailures += 1;
        logger.error("Payment scan failed for order.", {
          orderId: order.id,
          error: error instanceof Error ? error.message : "unknown_error"
        });
      }
    }

    if (orderFailures === 0) {
      await this.store.settings.set("wallet.last_scan_at", {
        lastSuccessfulScanAt: now.toISOString()
      });
    }
    await this.store.settings.set("wallet.scan_offsets", {
      openOffset: openWindow.nextOffset,
      expiredOffset: expiredWindow.nextOffset
    });

    logger.info("Completed payment scan.", {
      scannedOrders: scannedOrders.length,
      newlySeen,
      newlyConfirmed,
      newlyUnderpaid,
      orderFailures
    });

    return {
      scannedOrders: scannedOrders.length,
      newlySeen,
      newlyConfirmed,
      newlyUnderpaid,
      orderFailures
    };
  }

  private async loadScanWindow(
    states: Order["state"][],
    limit: number,
    offset: number
  ): Promise<{ orders: Order[]; nextOffset: number }> {
    let orders = await this.store.orders.listByStates(states, limit, offset);
    let effectiveOffset = offset;

    if (orders.length === 0 && offset > 0) {
      effectiveOffset = 0;
      orders = await this.store.orders.listByStates(states, limit, 0);
    }

    return {
      orders,
      nextOffset: orders.length < limit ? 0 : effectiveOffset + orders.length
    };
  }

  private async flagManualReview(orderId: string, error: unknown): Promise<void> {
    const existingRecord = await this.store.fulfillments.findByOrderId(orderId);
    const snapshot = await this.store.snapshots.findByOrderId(orderId);
    const message = error instanceof Error ? error.message : "Manual review is required.";

    await this.store.fulfillments.createOrUpdate({
      id: existingRecord?.id ?? randomUUID(),
      orderId,
      deliveryType: snapshot?.type ?? "text",
      status: "manual_review",
      attempts: existingRecord?.attempts ?? 0,
      lastErrorCode: message,
      deliveredAt: existingRecord?.deliveredAt ?? null,
      lastAttemptAt: new Date(),
      receiptMessageId: existingRecord?.receiptMessageId ?? null
    });
  }

  private chooseTransfer(
    order: Order,
    transfers: AggregatedTransfer[],
    now: Date
  ): {
    transfer: AggregatedTransfer | null;
    kind: "qualifying" | "underpaid";
    shouldExpire: boolean;
  } {
    if (order.paymentTxHash) {
      return {
        transfer: transfers.find((transfer) => transfer.txHash === order.paymentTxHash) ?? null,
        kind: "qualifying",
        shouldExpire: false
      };
    }

    const timelyTransfers = transfers.filter((transfer) => transfer.seenAt <= order.quoteExpiresAt);
    const timelyQualifying = timelyTransfers.find(
      (transfer) => transfer.amountAtomic >= order.quotedAmountAtomic
    );
    if (timelyQualifying) {
      return {
        transfer: timelyQualifying,
        kind: "qualifying",
        shouldExpire: false
      };
    }

    const timelyUnderpaid = timelyTransfers.find(
      (transfer) => transfer.amountAtomic < order.quotedAmountAtomic
    );
    if (timelyUnderpaid && now.getTime() > order.quoteExpiresAt.getTime()) {
      return {
        transfer: timelyUnderpaid,
        kind: "underpaid",
        shouldExpire: false
      };
    }

    return {
      transfer: null,
      kind: "qualifying",
      shouldExpire:
        transfers.length > 0 &&
        order.state === "awaiting_payment" &&
        now.getTime() > order.quoteExpiresAt.getTime()
    };
  }

  private groupTransfers(transfers: MoneroTransfer[]): Map<string, AggregatedTransfer[]> {
    const bySubaddress = new Map<string, Map<string, AggregatedTransfer>>();

    for (const transfer of transfers) {
      const bucketKey = transferBucketKey(transfer.accountIndex, transfer.subaddressIndex);
      const byTx = bySubaddress.get(bucketKey) ?? new Map<string, AggregatedTransfer>();
      const existing = byTx.get(transfer.txHash);
      if (existing) {
        byTx.set(transfer.txHash, {
          txHash: existing.txHash,
          amountAtomic: existing.amountAtomic + transfer.amountAtomic,
          confirmations: Math.max(existing.confirmations, transfer.confirmations),
          seenAt: existing.seenAt.getTime() < transfer.seenAt.getTime() ? existing.seenAt : transfer.seenAt
        });
      } else {
        byTx.set(transfer.txHash, {
          txHash: transfer.txHash,
          amountAtomic: transfer.amountAtomic,
          confirmations: transfer.confirmations,
          seenAt: transfer.seenAt
        });
      }
      bySubaddress.set(bucketKey, byTx);
    }

    return new Map(
      [...bySubaddress.entries()].map(([subaddressIndex, txMap]) => [
        subaddressIndex,
        [...txMap.values()].sort((left, right) => left.seenAt.getTime() - right.seenAt.getTime())
      ])
    );
  }

  private async upsertPaymentEvent(
    orderId: string,
    transfer: AggregatedTransfer,
    existingEvents: PaymentEvent[],
    category: PaymentEvent["category"]
  ): Promise<void> {
    const existingEvent = existingEvents.find((event) => event.txHash === transfer.txHash);
    await this.store.payments.upsert({
      id: existingEvent?.id ?? randomUUID(),
      orderId,
      txHash: transfer.txHash,
      amountAtomic: transfer.amountAtomic,
      confirmations: transfer.confirmations,
      category: existingEvent?.category ?? category,
      firstSeenAt: existingEvent?.firstSeenAt ?? transfer.seenAt,
      lastSeenAt: transfer.seenAt,
      confirmedAt: transfer.confirmations >= 1 ? transfer.seenAt : null
    });
  }
}
