import type { SilentCartStore } from "../repositories/store.js";

export interface GuideSection {
  key: string;
  title: string;
  body: string;
}

export class GuideService {
  public constructor(
    private readonly store: SilentCartStore,
    private readonly retentionDays: number
  ) {}

  public async getSections(): Promise<GuideSection[]> {
    const customWhy = await this.store.settings.get<{ message: string }>("guide.why_accept_monero");

    return [
      {
        key: "what",
        title: "What is Monero?",
        body:
          "Monero is a privacy-focused cryptocurrency. It is designed to hide wallet balances, transaction amounts, and payment graph details from casual observers."
      },
      {
        key: "why_people",
        title: "Why do people use it?",
        body:
          "People use Monero when they want fewer public traces around what they pay, what they receive, and which wallet is connected to which transaction history."
      },
      {
        key: "why_seller",
        title: "Why do I accept Monero?",
        body:
          customWhy?.message ??
          "I accept Monero because it reduces unnecessary payment exposure and keeps the checkout flow simple. That is the whole reason here."
      },
      {
        key: "how_to_pay",
        title: "How do I pay with Monero?",
        body:
          "Open your Monero wallet, send the exact quoted XMR amount to the order address, and wait for 1 confirmation. Underpaid orders are not fulfilled. Overpayments are not refunded."
      },
      {
        key: "data_policy",
        title: "What data does this bot keep, and when is it deleted?",
        body:
          `The bot keeps only the Telegram user ID link needed to deliver your purchase and allow temporary re-delivery. By default that link is severed ${this.retentionDays} days after fulfillment. Anonymous operational order records remain.`
      }
    ];
  }

  public async setWhyAcceptMoneroMessage(message: string): Promise<void> {
    await this.store.settings.set("guide.why_accept_monero", {
      message
    });
  }
}
