import { createHash, randomUUID } from "node:crypto";
import { ConflictError, NotFoundError, ValidationError } from "../domain/errors.js";
import type {
  DownloadLinkPayload,
  FilePayload,
  LicenseProductPayload,
  PricingMode,
  Product,
  ProductPayload,
  ProductType,
  TextPayload
} from "../domain/models.js";
import { EncryptionService } from "../crypto/encryption.js";
import type { SilentCartStore } from "../repositories/store.js";
import { xmrToAtomic } from "../utils/money.js";
import { sanitizePlainText, validateUrl } from "../utils/validation.js";

export interface CreateProductInput {
  title: string;
  shortDescription: string;
  type: ProductType;
  pricingMode: PricingMode;
  fixedXmrAmount?: string;
  usdPriceCents?: number;
  payload: ProductPayload;
  active?: boolean;
}

export interface UpdateProductInput {
  title?: string;
  shortDescription?: string;
  pricingMode?: PricingMode;
  fixedXmrAmountAtomic?: bigint | null;
  usdPriceCents?: number | null;
  payload?: ProductPayload;
  active?: boolean;
}

export class CatalogService {
  public constructor(
    private readonly store: SilentCartStore,
    private readonly encryptionService: EncryptionService
  ) {}

  public async listActiveProducts(): Promise<Product[]> {
    return this.store.products.listActive();
  }

  public async listAllProducts(): Promise<Product[]> {
    return this.store.products.listAll();
  }

  public async listLicenseProducts(): Promise<Product[]> {
    return this.store.products.listLicenseProducts();
  }

  public async getProductById(productId: string): Promise<Product> {
    const product = await this.store.products.findById(productId);
    if (!product) {
      throw new NotFoundError("Product not found.");
    }
    return product;
  }

  public async createProduct(input: CreateProductInput): Promise<Product> {
    this.validatePricing(input.pricingMode, input.fixedXmrAmount ?? null, input.usdPriceCents ?? null);
    const payload = this.validatePayload(input.type, input.payload);

    return this.store.products.create({
      id: randomUUID(),
      title: sanitizePlainText(input.title, 120),
      shortDescription: sanitizePlainText(input.shortDescription, 500),
      type: input.type,
      pricingMode: input.pricingMode,
      fixedPriceAtomic:
        input.pricingMode === "fixed_xmr" && input.fixedXmrAmount
          ? this.parseAtomic(input.fixedXmrAmount)
          : null,
      usdPriceCents: input.pricingMode === "usd_anchored" ? input.usdPriceCents ?? null : null,
      encryptedPayload: this.encryptionService.encryptJson(payload),
      active: input.active ?? true
    });
  }

  public async updateProduct(productId: string, input: UpdateProductInput): Promise<Product> {
    const product = await this.getProductById(productId);

    if (input.pricingMode || input.fixedXmrAmountAtomic !== undefined || input.usdPriceCents !== undefined) {
      this.validatePricing(
        input.pricingMode ?? product.pricingMode,
        input.fixedXmrAmountAtomic ?? product.fixedPriceAtomic,
        input.usdPriceCents ?? product.usdPriceCents
      );
    }

    const patch = {
      title: input.title ? sanitizePlainText(input.title, 120) : undefined,
      shortDescription: input.shortDescription
        ? sanitizePlainText(input.shortDescription, 500)
        : undefined,
      pricingMode: input.pricingMode,
      fixedPriceAtomic:
        input.fixedXmrAmountAtomic !== undefined ? input.fixedXmrAmountAtomic : undefined,
      usdPriceCents: input.usdPriceCents,
      encryptedPayload:
        input.payload !== undefined
          ? this.encryptionService.encryptJson(this.validatePayload(product.type, input.payload))
          : undefined,
      active: input.active
    };

    return this.store.products.update(productId, patch);
  }

  public async setActive(productId: string, active: boolean): Promise<Product> {
    await this.getProductById(productId);
    return this.store.products.update(productId, { active });
  }

  public async getDecryptedPayload(product: Product): Promise<ProductPayload> {
    if (!product.encryptedPayload) {
      throw new ConflictError("Product payload is missing.");
    }
    return this.decryptStoredPayload<ProductPayload>(product.encryptedPayload);
  }

  public decryptStoredPayload<T>(serialized: string): T {
    return this.encryptionService.decryptJson<T>(serialized);
  }

  public async addLicenseStock(productId: string, keys: string[]): Promise<number> {
    const product = await this.getProductById(productId);
    if (product.type !== "license_key") {
      throw new ValidationError("Only license-key products can receive license stock.");
    }

    const cleaned = keys
      .map((key) => key.trim())
      .filter(Boolean)
      .map((key) => sanitizePlainText(key, 500));

    if (cleaned.length === 0) {
      throw new ValidationError("No license keys were provided.");
    }

    const fingerprints = cleaned.map((key) => this.buildSecretFingerprint(key));
    if (new Set(fingerprints).size !== fingerprints.length) {
      throw new ValidationError("Duplicate license keys were found in the import batch.");
    }

    const existingStock = await this.store.licenseStock.listByProductId(productId);
    const existingFingerprints = new Set(
      existingStock.map((item) =>
        item.secretFingerprint ??
        this.buildSecretFingerprint(this.decryptStoredPayload<{ key: string }>(item.encryptedSecret).key)
      )
    );

    for (const fingerprint of fingerprints) {
      if (existingFingerprints.has(fingerprint)) {
        throw new ValidationError("One or more license keys already exist in stock for this product.");
      }
    }

    for (const [index, key] of cleaned.entries()) {
      try {
        await this.store.licenseStock.add({
          id: randomUUID(),
          productId,
          encryptedSecret: this.encryptionService.encryptJson({ key }),
          secretFingerprint: fingerprints[index] ?? null
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("license_stock_items_product_fingerprint_idx")) {
          throw new ValidationError("One or more license keys already exist in stock for this product.");
        }
        throw error;
      }
    }

    return cleaned.length;
  }

  public async getLicenseStockSummary(productId: string): Promise<{
    available: number;
    reserved: number;
    consumed: number;
  }> {
    const stock = await this.store.licenseStock.listByProductId(productId);
    return {
      available: stock.filter((item) => item.state === "available").length,
      reserved: stock.filter((item) => item.state === "reserved").length,
      consumed: stock.filter((item) => item.state === "consumed").length
    };
  }

  private validatePricing(
    pricingMode: PricingMode,
    fixedXmrAmount: string | bigint | null,
    usdPriceCents: number | null
  ): void {
    if (pricingMode === "fixed_xmr" && fixedXmrAmount === null) {
      throw new ValidationError("Fixed XMR products need a fixed XMR price.");
    }
    if (pricingMode === "usd_anchored" && (usdPriceCents === null || usdPriceCents <= 0)) {
      throw new ValidationError("USD-anchored products need a positive USD price.");
    }
  }

  private validatePayload(type: ProductType, payload: ProductPayload): ProductPayload {
    if (payload.kind !== type) {
      throw new ValidationError("Product payload kind does not match product type.");
    }

    switch (type) {
      case "file":
        return this.validateFilePayload(payload as FilePayload);
      case "text":
        return this.validateTextPayload(payload as TextPayload);
      case "download_link":
        return this.validateLinkPayload(payload as DownloadLinkPayload);
      case "license_key":
        return this.validateLicensePayload(payload as LicenseProductPayload);
    }
  }

  private validateFilePayload(payload: FilePayload): FilePayload {
    return {
      kind: "file",
      telegramFileId: sanitizePlainText(payload.telegramFileId, 300),
      fileName: payload.fileName ? sanitizePlainText(payload.fileName, 200) : undefined,
      caption: payload.caption ? sanitizePlainText(payload.caption, 500) : undefined
    };
  }

  private validateTextPayload(payload: TextPayload): TextPayload {
    return {
      kind: "text",
      content: sanitizePlainText(payload.content, 12000)
    };
  }

  private validateLinkPayload(payload: DownloadLinkPayload): DownloadLinkPayload {
    return {
      kind: "download_link",
      url: validateUrl(payload.url),
      label: payload.label ? sanitizePlainText(payload.label, 120) : undefined,
      note: payload.note ? sanitizePlainText(payload.note, 500) : undefined
    };
  }

  private validateLicensePayload(payload: LicenseProductPayload): LicenseProductPayload {
    return {
      kind: "license_key",
      note: payload.note ? sanitizePlainText(payload.note, 500) : undefined
    };
  }

  private parseAtomic(value: string): bigint {
    if (!/^\d+(\.\d{1,12})?$/.test(value.trim())) {
      throw new ValidationError("Invalid XMR amount.");
    }
    return xmrToAtomic(value.trim());
  }

  private buildSecretFingerprint(secret: string): string {
    return createHash("sha256").update(secret).digest("hex");
  }
}
