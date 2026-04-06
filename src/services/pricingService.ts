import type { PricingMode, Product, PublicProductView, QuoteResult } from "../domain/models.js";
import { ValidationError } from "../domain/errors.js";
import { atomicToXmr, formatUsdCents, usdCentsToAtomic } from "../utils/money.js";

export interface ExchangeRateProvider {
  getUsdPerXmr(): Promise<number>;
}

export class CoinGeckoRateProvider implements ExchangeRateProvider {
  private cachedValue: { rate: number; expiresAt: number } | null = null;

  public constructor(private readonly apiBaseUrl: string) {}

  public async getUsdPerXmr(): Promise<number> {
    if (this.cachedValue && this.cachedValue.expiresAt > Date.now()) {
      return this.cachedValue.rate;
    }

    const response = await fetch(
      `${this.apiBaseUrl}/simple/price?ids=monero&vs_currencies=usd`,
      {
        headers: {
          accept: "application/json"
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Exchange rate request failed with status ${response.status}`);
    }

    const body = (await response.json()) as { monero?: { usd?: number } };
    const rate = body.monero?.usd;
    if (!rate || rate <= 0) {
      throw new Error("Exchange rate provider returned an invalid XMR/USD rate.");
    }

    this.cachedValue = {
      rate,
      expiresAt: Date.now() + 60_000
    };

    return rate;
  }
}

export class PricingService {
  public constructor(
    private readonly exchangeRateProvider: ExchangeRateProvider | null,
    private readonly usdReferenceEnabled: boolean
  ) {}

  public async freezeQuote(product: Product): Promise<QuoteResult> {
    if (product.pricingMode === "fixed_xmr") {
      if (product.fixedPriceAtomic === null) {
        throw new ValidationError("Fixed XMR product is missing a fixed XMR price.");
      }

      const usdReference =
        this.usdReferenceEnabled && this.exchangeRateProvider
          ? await this.estimateUsdReference(product.fixedPriceAtomic).catch(() => null)
          : null;

      return {
        pricingMode: product.pricingMode,
        quotedAmountAtomic: product.fixedPriceAtomic,
        quotedAmountXmr: atomicToXmr(product.fixedPriceAtomic),
        usdReferenceCents: usdReference,
        usdPerXmr: null
      };
    }

    if (product.usdPriceCents === null) {
      throw new ValidationError("USD-anchored product is missing a USD price.");
    }

    if (!this.exchangeRateProvider) {
      throw new ValidationError("USD pricing needs an exchange rate provider.");
    }

    const usdPerXmr = await this.exchangeRateProvider.getUsdPerXmr();
    const quotedAmountAtomic = usdCentsToAtomic(product.usdPriceCents, usdPerXmr);

    return {
      pricingMode: product.pricingMode,
      quotedAmountAtomic,
      quotedAmountXmr: atomicToXmr(quotedAmountAtomic),
      usdReferenceCents: product.usdPriceCents,
      usdPerXmr
    };
  }

  public async buildPublicProductView(product: Product): Promise<PublicProductView> {
    const quote = await this.freezeQuote(product);
    return {
      id: product.id,
      title: product.title,
      shortDescription: product.shortDescription,
      type: product.type,
      pricingMode: product.pricingMode as PricingMode,
      active: product.active,
      xmrAmount: quote.quotedAmountXmr,
      usdReference: formatUsdCents(quote.usdReferenceCents)
    };
  }

  private async estimateUsdReference(quotedAmountAtomic: bigint): Promise<number | null> {
    if (!this.exchangeRateProvider) {
      return null;
    }
    const usdPerXmr = await this.exchangeRateProvider.getUsdPerXmr();
    const xmr = Number(atomicToXmr(quotedAmountAtomic));
    return Math.round(xmr * usdPerXmr * 100);
  }
}
