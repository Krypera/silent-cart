import { randomUUID } from "node:crypto";
import type { MoneroPaymentAdapter } from "../monero/types.js";
import { ConflictError, NotFoundError } from "../domain/errors.js";
import type { LicenseReservationReference, Order, ProductPayload } from "../domain/models.js";
import type { SilentCartStore } from "../repositories/store.js";
import { CatalogService } from "./catalogService.js";
import { PricingService } from "./pricingService.js";
import { assertOrderTransition } from "./orderStateMachine.js";

export class OrderService {
  public constructor(
    private readonly store: SilentCartStore,
    private readonly catalogService: CatalogService,
    private readonly pricingService: PricingService,
    private readonly moneroAdapter: MoneroPaymentAdapter,
    private readonly quoteLifetimeMinutes: number
  ) {}

  public async createOrder(productId: string, telegramUserId: bigint, now = new Date()): Promise<Order> {
    const product = await this.catalogService.getProductById(productId);
    if (!product.active) {
      throw new ConflictError("This product is not currently available.");
    }

    const orderId = randomUUID();
    const quote = await this.pricingService.freezeQuote(product);
    const paymentTarget = await this.moneroAdapter.createSubaddress(`silentcart:${orderId}`);

    return this.store.withTransaction(async (tx) => {
      let payloadReference: string | null = null;

      if (product.type === "license_key") {
        const reservation = await tx.licenseStock.reserveAvailable(product.id, orderId);
        if (!reservation) {
          throw new ConflictError("This license product is currently out of stock.");
        }
        payloadReference = this.serializeLicenseReference(reservation.id);
      }

      const createdOrder = await tx.orders.create({
        id: orderId,
        productId: product.id,
        state: "created",
        prePurgeState: null,
        pricingMode: quote.pricingMode,
        quotedAmountAtomic: quote.quotedAmountAtomic,
        quotedAmountXmr: quote.quotedAmountXmr,
        usdReferenceCents: quote.usdReferenceCents,
        paymentAddress: paymentTarget.address,
        accountIndex: paymentTarget.accountIndex,
        subaddressIndex: paymentTarget.subaddressIndex,
        quoteExpiresAt: new Date(now.getTime() + this.quoteLifetimeMinutes * 60 * 1000),
        paymentTxHash: null,
        paymentReceivedAtomic: null,
        paymentSeenAt: null,
        confirmedAt: null,
        fulfilledAt: null
      });

      await tx.snapshots.create({
        id: randomUUID(),
        orderId,
        productId: product.id,
        title: product.title,
        shortDescription: product.shortDescription,
        type: product.type,
        pricingMode: quote.pricingMode,
        quotedAmountAtomic: quote.quotedAmountAtomic,
        quotedAmountXmr: quote.quotedAmountXmr,
        usdReferenceCents: quote.usdReferenceCents,
        encryptedPayloadSnapshot: product.encryptedPayload,
        payloadReference
      });

      await tx.retention.create({
        orderId,
        telegramUserId,
        expiresAt: null,
        purgedAt: null
      });

      assertOrderTransition(createdOrder.state, "awaiting_payment");
      return tx.orders.update(orderId, {
        state: "awaiting_payment"
      });
    });
  }

  public async getOrder(orderId: string): Promise<Order> {
    const order = await this.store.orders.findById(orderId);
    if (!order) {
      throw new NotFoundError("Order not found.");
    }
    return order;
  }

  public async expireOrder(orderId: string, now: Date): Promise<Order> {
    return this.store.withTransaction(async (tx) => {
      const order = await this.requireOrder(tx, orderId);
      if (order.state === "expired" || order.state === "purged") {
        return order;
      }
      assertOrderTransition(order.state, "expired");
      await tx.retention.update(orderId, { expiresAt: now });
      return tx.orders.update(orderId, { state: "expired" });
    });
  }

  public async reopenExpiredOrder(orderId: string): Promise<Order> {
    return this.store.withTransaction(async (tx) => {
      const order = await this.requireOrder(tx, orderId);
      if (order.state !== "expired") {
        return order;
      }

      const snapshot = await tx.snapshots.findByOrderId(orderId);
      if (!snapshot) {
        throw new NotFoundError("Order snapshot is missing.");
      }

      if (snapshot.type === "license_key") {
        const existingReserved = await tx.licenseStock.findByReservedOrderId(orderId);
        const existingConsumed = await tx.licenseStock.findByConsumedOrderId(orderId);
        const reservation =
          existingReserved ??
          existingConsumed ??
          (await tx.licenseStock.reserveAvailable(order.productId, orderId));

        if (!reservation) {
          throw new ConflictError(
            "The reserved license key for this recovered payment is no longer available. Manual review is required."
          );
        }

        await tx.snapshots.update(orderId, {
          payloadReference: this.serializeLicenseReference(reservation.id)
        });
      }

      await tx.retention.update(orderId, {
        expiresAt: null
      });
      assertOrderTransition(order.state, "awaiting_payment");
      return tx.orders.update(orderId, {
        state: "awaiting_payment"
      });
    });
  }

  public async markUnderpaid(
    orderId: string,
    txHash: string,
    amountAtomic: bigint,
    seenAt: Date
  ): Promise<Order> {
    return this.store.withTransaction(async (tx) => {
      const order = await this.requireOrder(tx, orderId);
      if (order.state === "underpaid" || order.state === "purged") {
        return order;
      }

      assertOrderTransition(order.state, "underpaid");
      await tx.licenseStock.releaseReservation(orderId);
      await tx.retention.update(orderId, { expiresAt: seenAt });
      return tx.orders.update(orderId, {
        state: "underpaid",
        paymentTxHash: txHash,
        paymentReceivedAtomic: amountAtomic,
        paymentSeenAt: seenAt
      });
    });
  }

  public async markPaymentSeen(
    orderId: string,
    txHash: string,
    amountAtomic: bigint,
    seenAt: Date
  ): Promise<Order> {
    return this.store.withTransaction(async (tx) => {
      const order = await this.requireOrder(tx, orderId);
      if (order.state === "payment_seen" || order.state === "confirmed" || order.state === "fulfilled") {
        return order;
      }
      assertOrderTransition(order.state, "payment_seen");
      return tx.orders.update(orderId, {
        state: "payment_seen",
        paymentTxHash: txHash,
        paymentReceivedAtomic: amountAtomic,
        paymentSeenAt: seenAt
      });
    });
  }

  public async markConfirmed(
    orderId: string,
    txHash: string,
    amountAtomic: bigint,
    now: Date,
    seenAt = now
  ): Promise<Order> {
    return this.store.withTransaction(async (tx) => {
      const order = await this.requireOrder(tx, orderId);
      if (order.state === "confirmed" || order.state === "fulfilled") {
        return order;
      }

      if (order.state === "awaiting_payment") {
        await tx.orders.update(orderId, {
          state: "payment_seen",
          paymentTxHash: txHash,
          paymentReceivedAtomic: amountAtomic,
          paymentSeenAt: seenAt
        });
      } else if (order.state !== "payment_seen") {
        throw new ConflictError(`Order ${order.id} cannot be confirmed from ${order.state}.`);
      }

      assertOrderTransition("payment_seen", "confirmed");
      return tx.orders.update(orderId, {
        state: "confirmed",
        paymentTxHash: txHash,
        paymentReceivedAtomic: amountAtomic,
        confirmedAt: now
      });
    });
  }

  public async markFulfilled(orderId: string, now: Date): Promise<Order> {
    return this.store.withTransaction(async (tx) => {
      const order = await this.requireOrder(tx, orderId);
      if (order.state === "fulfilled") {
        return order;
      }
      assertOrderTransition(order.state, "fulfilled");
      return tx.orders.update(orderId, {
        state: "fulfilled",
        fulfilledAt: now
      });
    });
  }

  public async getSnapshotPayload(orderId: string): Promise<{
    snapshotPayload: ProductPayload;
    payloadReference: LicenseReservationReference | null;
  }> {
    const snapshot = await this.store.snapshots.findByOrderId(orderId);
    if (!snapshot?.encryptedPayloadSnapshot) {
      throw new NotFoundError("Order snapshot is missing.");
    }

    return {
      snapshotPayload: this.catalogService.decryptStoredPayload<ProductPayload>(
        snapshot.encryptedPayloadSnapshot
      ),
      payloadReference: snapshot.payloadReference
        ? (JSON.parse(snapshot.payloadReference) as LicenseReservationReference)
        : null
    };
  }

  private async requireOrder(store: SilentCartStore, orderId: string): Promise<Order> {
    const order = await store.orders.findById(orderId);
    if (!order) {
      throw new NotFoundError("Order not found.");
    }
    return order;
  }

  private serializeLicenseReference(stockItemId: string): string {
    return JSON.stringify({
      stockItemId
    } satisfies LicenseReservationReference);
  }
}
