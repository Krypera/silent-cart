import type { PaymentMonitorService } from "../services/paymentMonitorService.js";
import { OperatorAlertService } from "../services/operatorAlertService.js";

export class PaymentScanWorker {
  public constructor(
    private readonly paymentMonitorService: PaymentMonitorService,
    private readonly operatorAlertService: OperatorAlertService
  ) {}

  public async runOnce(): Promise<void> {
    try {
      const result = await this.paymentMonitorService.scan();
      if (result.orderFailures > 0) {
        await this.operatorAlertService.notifyPaymentScanPartial(result.orderFailures, result.scannedOrders);
      }
    } catch (error) {
      await this.operatorAlertService.notifyPaymentScanFailure(error);
      throw error;
    }
  }
}
