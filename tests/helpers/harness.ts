import type { MoneroPaymentAdapter, MoneroTransfer, SubaddressAllocation, WalletHeightInfo, WalletVersionInfo } from "../../src/monero/types.js";
import { EncryptionService } from "../../src/crypto/encryption.js";
import { InMemoryStore } from "../../src/repositories/inMemoryStore.js";
import { AdminAuthorizationService } from "../../src/services/adminAuthorizationService.js";
import { CatalogService } from "../../src/services/catalogService.js";
import { FulfillmentEngine, type DeliveryMessenger } from "../../src/services/fulfillment/fulfillmentEngine.js";
import { GuideService } from "../../src/services/guideService.js";
import { OperatorAlertService } from "../../src/services/operatorAlertService.js";
import { OrderService } from "../../src/services/orderService.js";
import { PaymentMonitorService } from "../../src/services/paymentMonitorService.js";
import { PricingService, type ExchangeRateProvider } from "../../src/services/pricingService.js";
import { RetentionService } from "../../src/services/retentionService.js";
import { StatsService } from "../../src/services/statsService.js";
import { UserNotificationService } from "../../src/services/userNotificationService.js";
import { WalletHealthService } from "../../src/services/walletHealthService.js";

export class StaticRateProvider implements ExchangeRateProvider {
  public constructor(private readonly rate: number) {}

  public async getUsdPerXmr(): Promise<number> {
    return this.rate;
  }
}

export class FakeMoneroAdapter implements MoneroPaymentAdapter {
  private nextSubaddressIndex = 0;
  private transfers: MoneroTransfer[] = [];

  public async createSubaddress(): Promise<SubaddressAllocation> {
    const subaddressIndex = this.nextSubaddressIndex;
    this.nextSubaddressIndex += 1;

    return {
      address: `4SilentCartSubaddress${subaddressIndex}`,
      accountIndex: 0,
      subaddressIndex
    };
  }

  public async refresh(): Promise<void> {}

  public async getIncomingTransfers(args: {
    accountIndex: number;
    subaddressIndices: number[];
  }): Promise<MoneroTransfer[]> {
    return this.transfers.filter(
      (transfer) =>
        transfer.accountIndex === args.accountIndex &&
        args.subaddressIndices.includes(transfer.subaddressIndex)
    );
  }

  public async getWalletHeight(): Promise<WalletHeightInfo> {
    return {
      height: 123
    };
  }

  public async getVersion(): Promise<WalletVersionInfo> {
    return {
      version: 1
    };
  }

  public setTransfers(transfers: MoneroTransfer[]): void {
    this.transfers = transfers;
  }
}

export class FakeMessenger implements DeliveryMessenger {
  public readonly messages: Array<{ chatId: bigint; text: string }> = [];
  public readonly documents: Array<{ chatId: bigint; fileId: string; caption?: string }> = [];
  private nextMessageId = 1;

  public async sendMessage(chatId: bigint, text: string): Promise<{ messageId: number }> {
    this.messages.push({ chatId, text });
    return {
      messageId: this.nextMessageId++
    };
  }

  public async sendDocument(
    chatId: bigint,
    fileId: string,
    caption?: string
  ): Promise<{ messageId: number }> {
    this.documents.push({ chatId, fileId, caption });
    return {
      messageId: this.nextMessageId++
    };
  }
}

export function createHarness() {
  const store = new InMemoryStore();
  void store.admins.syncAllowlist([1n]);
  const encryptionService = new EncryptionService("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  const rateProvider = new StaticRateProvider(150);
  const pricingService = new PricingService(rateProvider, true);
  const catalogService = new CatalogService(store, encryptionService);
  const moneroAdapter = new FakeMoneroAdapter();
  const retentionService = new RetentionService(store, 30);
  const orderService = new OrderService(store, catalogService, pricingService, moneroAdapter, 30);
  const messenger = new FakeMessenger();
  const notificationMessenger = new FakeMessenger();
  const alertMessenger = new FakeMessenger();
  const userNotificationService = new UserNotificationService(store, notificationMessenger);
  const operatorAlertService = new OperatorAlertService(store, alertMessenger, 1000);
  const fulfillmentEngine = new FulfillmentEngine(
    store,
    catalogService,
    orderService,
    retentionService,
    messenger,
    operatorAlertService
  );

  return {
    store,
    encryptionService,
    pricingService,
    catalogService,
    moneroAdapter,
    retentionService,
    orderService,
    paymentMonitorService: new PaymentMonitorService(
      store,
      orderService,
      moneroAdapter,
      250,
      userNotificationService,
      operatorAlertService
    ),
    fulfillmentEngine,
    messenger,
    notificationMessenger,
    alertMessenger,
    userNotificationService,
    operatorAlertService,
    guideService: new GuideService(store, 30),
    adminAuthorizationService: new AdminAuthorizationService(store, [1n]),
    statsService: new StatsService(store),
    walletHealthService: new WalletHealthService(store, moneroAdapter, null)
  };
}
