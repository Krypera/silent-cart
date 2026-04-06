import { randomUUID } from "node:crypto";
import { ConflictError, NotFoundError } from "../../domain/errors.js";
import type {
  DownloadLinkPayload,
  FilePayload,
  FulfillmentRecord,
  LicenseReservationReference,
  LicenseProductPayload,
  Order,
  PaymentEvent,
  ProductPayload,
  TextPayload
} from "../../domain/models.js";
import { logger } from "../../logger/logger.js";
import type { SilentCartStore } from "../../repositories/store.js";
import { atomicToXmr, formatUsdCents } from "../../utils/money.js";
import { CatalogService } from "../catalogService.js";
import { OperatorAlertService } from "../operatorAlertService.js";
import { OrderService } from "../orderService.js";
import { RetentionService } from "../retentionService.js";

export interface DeliveryMessenger {
  sendMessage(chatId: bigint, text: string): Promise<{ messageId: number }>;
  sendDocument(chatId: bigint, fileId: string, caption?: string): Promise<{ messageId: number }>;
}

function splitMessage(text: string, limit = 3500): string[] {
  if (text.length <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    chunks.push(text.slice(cursor, cursor + limit));
    cursor += limit;
  }

  return chunks;
}

class DeliveryDispatchError extends Error {
  public readonly requiresManualReview: boolean;

  public constructor(message: string, requiresManualReview = false) {
    super(message);
    this.requiresManualReview = requiresManualReview;
  }
}

export class FulfillmentEngine {
  public constructor(
    private readonly store: SilentCartStore,
    private readonly catalogService: CatalogService,
    private readonly orderService: OrderService,
    private readonly retentionService: RetentionService,
    private readonly messenger: DeliveryMessenger,
    private readonly operatorAlertService: OperatorAlertService | null = null
  ) {}

  public async fulfillConfirmedOrders(): Promise<number> {
    const orders = await this.store.orders.listByStates(["confirmed"]);
    let fulfilledCount = 0;

    for (const order of orders) {
      const record = await this.fulfillOrder(order.id);
      if (record?.status === "delivered") {
        fulfilledCount += 1;
      }
    }

    return fulfilledCount;
  }

  public async fulfillOrder(orderId: string): Promise<FulfillmentRecord | null> {
    const order = await this.orderService.getOrder(orderId);
    if (order.state !== "confirmed" && order.state !== "fulfilled") {
      return null;
    }

    const link = await this.store.retention.findByOrderId(orderId);
    if (!link?.telegramUserId) {
      throw new NotFoundError("The Telegram delivery link for this order no longer exists.");
    }

    const existingRecord = await this.store.fulfillments.findByOrderId(orderId);
    if (existingRecord?.status === "delivered") {
      return existingRecord;
    }
    if (existingRecord?.status === "manual_review") {
      return existingRecord;
    }
    if (existingRecord?.status === "processing") {
      const manualReviewRecord = await this.store.fulfillments.createOrUpdate({
        id: existingRecord.id,
        orderId,
        deliveryType: existingRecord.deliveryType,
        status: "manual_review",
        attempts: existingRecord.attempts,
        lastErrorCode: "A previous fulfillment attempt did not finish cleanly. Manual review is required.",
        deliveredAt: existingRecord.deliveredAt,
        lastAttemptAt: new Date(),
        receiptMessageId: existingRecord.receiptMessageId
      });
      await this.operatorAlertService?.notifyManualReview(
        orderId,
        "A previous fulfillment attempt did not finish cleanly."
      );
      return manualReviewRecord;
    }

    return this.attemptDelivery(orderId, existingRecord, link.telegramUserId);
  }

  public async redeliver(orderId: string, requestedByTelegramUserId: bigint, adminOverride = false): Promise<void> {
    const order = await this.orderService.getOrder(orderId);
    if (order.state !== "fulfilled") {
      throw new ConflictError("Only fulfilled orders can be re-delivered.");
    }

    const link = await this.store.retention.findByOrderId(orderId);
    if (!link?.telegramUserId) {
      throw new ConflictError("The re-delivery window for this order has ended.");
    }

    if (!adminOverride && link.telegramUserId !== requestedByTelegramUserId) {
      throw new ConflictError("You are not allowed to re-deliver this order.");
    }

    await this.deliver(link.telegramUserId, orderId, true);
  }

  public async resolveManualReview(
    orderId: string,
    requestedByTelegramUserId: bigint,
    adminOverride = false
  ): Promise<FulfillmentRecord> {
    const existingRecord = await this.store.fulfillments.findByOrderId(orderId);
    if (!existingRecord || existingRecord.status !== "manual_review") {
      throw new ConflictError("This order is not waiting for manual review.");
    }

    const link = await this.store.retention.findByOrderId(orderId);
    if (!link?.telegramUserId) {
      throw new ConflictError("The temporary Telegram delivery link for this order no longer exists.");
    }

    if (!adminOverride && link.telegramUserId !== requestedByTelegramUserId) {
      throw new ConflictError("You are not allowed to resolve this order.");
    }

    let order = await this.orderService.getOrder(orderId);
    if (order.state === "expired") {
      const paymentEvent = await this.findRecoverablePaymentEvent(order);
      if (!paymentEvent) {
        throw new ConflictError("No timely qualifying payment is recorded for this order.");
      }
      if (paymentEvent.confirmations < 1) {
        throw new ConflictError("Payment is recorded, but it is still waiting for 1 confirmation.");
      }

      await this.orderService.reopenExpiredOrder(orderId);
      order = await this.orderService.markConfirmed(
        orderId,
        paymentEvent.txHash,
        paymentEvent.amountAtomic,
        new Date(),
        paymentEvent.firstSeenAt
      );
    }

    if (order.state !== "confirmed" && order.state !== "fulfilled") {
      throw new ConflictError("Only confirmed or fulfilled manual review orders can be delivered.");
    }

    return this.attemptDelivery(orderId, existingRecord, link.telegramUserId);
  }

  private async deliver(
    chatId: bigint,
    orderId: string,
    isRedelivery = false
  ): Promise<{ receiptMessageId: number | null }> {
    const order = await this.orderService.getOrder(orderId);
    const snapshot = await this.store.snapshots.findByOrderId(orderId);
    if (!snapshot?.encryptedPayloadSnapshot) {
      throw new NotFoundError("Order snapshot payload is missing.");
    }

    const payload = this.catalogService.decryptStoredPayload<ProductPayload>(snapshot.encryptedPayloadSnapshot);
    const deliveryTextPrefix = isRedelivery ? "Re-delivery for your order" : "Your order is ready";

    try {
      if (payload.kind === "file") {
        await this.sendFile(chatId, payload, deliveryTextPrefix);
      } else if (payload.kind === "text") {
        await this.sendText(chatId, payload, deliveryTextPrefix);
      } else if (payload.kind === "download_link") {
        await this.sendLink(chatId, payload, deliveryTextPrefix);
      } else {
        await this.sendLicense(chatId, order, payload, deliveryTextPrefix);
      }
    } catch (error) {
      throw new DeliveryDispatchError(
        error instanceof Error ? error.message : "payload delivery failed",
        true
      );
    }

    const receipt = this.buildReceipt(order, isRedelivery);
    try {
      const response = await this.messenger.sendMessage(chatId, receipt);
      return {
        receiptMessageId: response.messageId
      };
    } catch (error) {
      logger.warn("Fulfillment receipt send failed after payload delivery.", {
        orderId,
        error: error instanceof Error ? error.message : "unknown_error"
      });
      return {
        receiptMessageId: null
      };
    }
  }

  private async sendFile(chatId: bigint, payload: FilePayload, deliveryTextPrefix: string): Promise<void> {
    await this.messenger.sendDocument(
      chatId,
      payload.telegramFileId,
      payload.caption ? `${deliveryTextPrefix}\n\n${payload.caption}` : deliveryTextPrefix
    );
  }

  private async sendText(chatId: bigint, payload: TextPayload, deliveryTextPrefix: string): Promise<void> {
    for (const chunk of splitMessage(`${deliveryTextPrefix}\n\n${payload.content}`)) {
      await this.messenger.sendMessage(chatId, chunk);
    }
  }

  private async sendLink(chatId: bigint, payload: DownloadLinkPayload, deliveryTextPrefix: string): Promise<void> {
    const lines = [deliveryTextPrefix, "", payload.label ?? "Download link", payload.url];
    if (payload.note) {
      lines.push("", payload.note);
    }
    await this.messenger.sendMessage(chatId, lines.join("\n"));
  }

  private async sendLicense(
    chatId: bigint,
    order: Order,
    payload: LicenseProductPayload,
    deliveryTextPrefix: string
  ): Promise<void> {
    const consumed = await this.ensureLicenseAssigned(order);
    if (!consumed) {
      throw new NotFoundError("Reserved license key is missing.");
    }

    const secret = this.catalogService.decryptStoredPayload<{ key: string }>(consumed.encryptedSecret);
    const lines = [deliveryTextPrefix];
    if (payload.note) {
      lines.push("", payload.note);
    }
    lines.push("", `License key:\n${secret.key}`);

    await this.messenger.sendMessage(chatId, lines.join("\n"));
  }

  private buildReceipt(order: Awaited<ReturnType<OrderService["getOrder"]>>, isRedelivery: boolean): string {
    const lines = [
      isRedelivery ? "Re-delivery complete." : "Payment confirmed. Delivery complete.",
      "",
      `Order ID: ${order.id}`,
      `Amount settled: ${atomicToXmr(order.quotedAmountAtomic)} XMR`
    ];

    if (order.usdReferenceCents !== null) {
      lines.push(`USD reference at quote time: ${formatUsdCents(order.usdReferenceCents)}`);
    }

    if (order.paymentTxHash) {
      lines.push(`Payment reference: ${order.paymentTxHash}`);
    }

    lines.push(
      "",
      "Prices settle in Monero. USD is shown only as a reference.",
      "The Telegram delivery link is kept only for temporary re-delivery and is later severed."
    );

    return lines.join("\n");
  }

  private async ensureLicenseAssigned(order: Order) {
    return this.store.withTransaction(async (tx) => {
      const finalized = await tx.licenseStock.finalizeReservation(order.id);
      if (finalized) {
        return finalized;
      }

      const consumed = await tx.licenseStock.findByConsumedOrderId(order.id);
      if (consumed) {
        return consumed;
      }

      const recovered = await tx.licenseStock.reserveAvailable(order.productId, order.id);
      if (!recovered) {
        return null;
      }

      await tx.snapshots.update(order.id, {
        payloadReference: JSON.stringify({
          stockItemId: recovered.id
        } satisfies LicenseReservationReference)
      });

      return tx.licenseStock.finalizeReservation(order.id);
    });
  }

  private async attemptDelivery(
    orderId: string,
    existingRecord: FulfillmentRecord | null,
    telegramUserId: bigint
  ): Promise<FulfillmentRecord> {
    const order = await this.orderService.getOrder(orderId);
    const snapshot = await this.store.snapshots.findByOrderId(orderId);
    const startTime = new Date();
    const attempts = (existingRecord?.attempts ?? 0) + 1;

    await this.store.fulfillments.createOrUpdate({
      id: existingRecord?.id ?? randomUUID(),
      orderId,
      deliveryType: snapshot?.type ?? "text",
      status: "processing",
      attempts,
      lastErrorCode: null,
      deliveredAt: existingRecord?.deliveredAt ?? null,
      lastAttemptAt: startTime,
      receiptMessageId: existingRecord?.receiptMessageId ?? null
    });

    try {
      const { receiptMessageId } = await this.deliver(telegramUserId, orderId);
      const deliveredAt = new Date();
      const record = await this.store.fulfillments.createOrUpdate({
        id: existingRecord?.id ?? randomUUID(),
        orderId,
        deliveryType: snapshot?.type ?? "text",
        status: "delivered",
        attempts,
        lastErrorCode: null,
        deliveredAt,
        lastAttemptAt: startTime,
        receiptMessageId
      });

      if (order.state !== "fulfilled") {
        await this.orderService.markFulfilled(orderId, deliveredAt);
      }
      await this.retentionService.activateForFulfilledOrder(orderId, deliveredAt);
      return record;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_delivery_error";
      const status =
        error instanceof DeliveryDispatchError && error.requiresManualReview ? "manual_review" : "failed";
      logger.error("Fulfillment failed.", {
        orderId,
        error: message,
        status
      });
      const record = await this.store.fulfillments.createOrUpdate({
        id: existingRecord?.id ?? randomUUID(),
        orderId,
        deliveryType: snapshot?.type ?? "text",
        status,
        attempts,
        lastErrorCode: message,
        deliveredAt: null,
        lastAttemptAt: startTime,
        receiptMessageId: null
      });
      if (status === "manual_review") {
        await this.operatorAlertService?.notifyManualReview(orderId, message);
      }
      return record;
    }
  }

  private async findRecoverablePaymentEvent(order: Order): Promise<PaymentEvent | null> {
    const paymentEvents = await this.store.payments.findByOrderId(order.id);
    return (
      paymentEvents.find(
        (event) => event.category === "qualifying" && event.firstSeenAt.getTime() <= order.quoteExpiresAt.getTime()
      ) ?? null
    );
  }
}
