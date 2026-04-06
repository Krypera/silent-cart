import type { AppServices } from "../../app/services.js";
import {
  ConflictError,
  ExternalServiceError,
  NotFoundError,
  ValidationError
} from "../../domain/errors.js";
import type { Product, ProductType } from "../../domain/models.js";
import { atomicToXmr, formatUsdCents } from "../../utils/money.js";

export function productTypeLabel(type: ProductType): string {
  switch (type) {
    case "file":
      return "File delivery";
    case "text":
      return "Text/code delivery";
    case "download_link":
      return "Download link delivery";
    case "license_key":
      return "License key delivery";
  }
}

export function getMatchValue(match: RegExpExecArray, index = 1): string | null {
  return match[index] ?? null;
}

export async function buildCatalogEntry(
  services: AppServices,
  product: Product
): Promise<{
  id: string;
  title: string;
  type: ProductType;
  xmrAmount: string | null;
  usdReference: string | null;
  pricingAvailable: boolean;
}> {
  try {
    const view = await services.pricingService.buildPublicProductView(product);
    return {
      id: view.id,
      title: view.title,
      type: view.type,
      xmrAmount: view.xmrAmount,
      usdReference: view.usdReference,
      pricingAvailable: true
    };
  } catch {
    return {
      id: product.id,
      title: product.title,
      type: product.type,
      xmrAmount: product.fixedPriceAtomic !== null ? atomicToXmr(product.fixedPriceAtomic) : null,
      usdReference: formatUsdCents(product.usdPriceCents),
      pricingAvailable: product.fixedPriceAtomic !== null
    };
  }
}

export function customerErrorMessage(error: unknown): string {
  if (error instanceof ExternalServiceError) {
    return "Pricing or wallet connectivity is temporarily unavailable. Please try again later.";
  }

  if (error instanceof NotFoundError || error instanceof ConflictError || error instanceof ValidationError) {
    return error.message;
  }

  return "The request could not be completed right now. Please try again later.";
}
