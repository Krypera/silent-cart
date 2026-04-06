import type { OrderState } from "../domain/models.js";

const transitions: Record<OrderState, OrderState[]> = {
  created: ["awaiting_payment", "expired"],
  awaiting_payment: ["payment_seen", "underpaid", "expired"],
  payment_seen: ["confirmed"],
  confirmed: ["fulfilled"],
  fulfilled: ["purged"],
  underpaid: ["purged"],
  expired: ["awaiting_payment", "underpaid", "purged"],
  purged: []
};

export function canTransitionOrder(from: OrderState, to: OrderState): boolean {
  return transitions[from].includes(to);
}

export function assertOrderTransition(from: OrderState, to: OrderState): void {
  if (!canTransitionOrder(from, to)) {
    throw new Error(`Invalid order transition: ${from} -> ${to}`);
  }
}
