import { FulfillmentEngine } from "../services/fulfillment/fulfillmentEngine.js";

export class FulfillmentRetryWorker {
  public constructor(private readonly fulfillmentEngine: FulfillmentEngine) {}

  public async runOnce(): Promise<void> {
    await this.fulfillmentEngine.fulfillConfirmedOrders();
  }
}
