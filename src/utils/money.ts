const ATOMIC_UNITS_PER_XMR = 1_000_000_000_000n;

export function xmrToAtomic(xmrAmount: string): bigint {
  const trimmed = xmrAmount.trim();
  if (!/^\d+(\.\d{1,12})?$/.test(trimmed)) {
    throw new Error("Invalid XMR amount");
  }

  const parts = trimmed.split(".");
  const wholePart = parts[0] ?? "0";
  const fractionalPart = parts[1] ?? "";
  const paddedFraction = `${fractionalPart}${"0".repeat(12)}`.slice(0, 12);

  return BigInt(wholePart) * ATOMIC_UNITS_PER_XMR + BigInt(paddedFraction);
}

export function atomicToXmr(amountAtomic: bigint): string {
  const whole = amountAtomic / ATOMIC_UNITS_PER_XMR;
  const fraction = amountAtomic % ATOMIC_UNITS_PER_XMR;
  const fractionText = fraction.toString().padStart(12, "0").replace(/0+$/, "");

  return fractionText.length > 0 ? `${whole}.${fractionText}` : whole.toString();
}

export function usdCentsToAtomic(usdCents: number, usdPerXmr: number): bigint {
  const usd = usdCents / 100;
  const xmr = usd / usdPerXmr;
  return xmrToAtomic(xmr.toFixed(12));
}

export function formatUsdCents(usdCents: number | null): string | null {
  if (usdCents === null) {
    return null;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(usdCents / 100);
}
