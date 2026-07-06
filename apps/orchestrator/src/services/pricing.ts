import type { Tier } from '@marketplace/core';

// Per-professional tier pricing with platform defaults. The schema has no
// pricing table (deliberately — schema.sql is frozen), so overrides are
// configuration: env JSON in production, literals in tests.
export type TierPrices = Record<Tier, string>;

export interface PricingConfig {
  defaults: TierPrices;
  /** professionalId -> partial tier price overrides */
  overrides: Record<string, Partial<TierPrices>>;
}

export const PLATFORM_DEFAULT_PRICES: TierPrices = {
  IN_HOURS: '2000.00',
  OFF_DUTY: '3500.00',
  OFF_DAY: '5000.00',
  PREMIUM_INTERRUPT: '8000.00',
};

// SERVICE providers self-register and set their own flat price
// (professionals.service_flat_price); this default only covers rows where
// they have not set one yet.
export const PLATFORM_DEFAULT_SERVICE_PRICE = '1000.00';

export function priceFor(config: PricingConfig, professionalId: string, tier: Tier): string {
  return config.overrides[professionalId]?.[tier] ?? config.defaults[tier];
}

// numeric(12,2) math on integer cents — money never touches floats.
export function computeBreakdown(gross: string, feePercent: string): { gross: string; fee: string; net: string } {
  const grossCents = toCents(gross);
  // fee_percent is numeric(5,2): scale by 10000 = 100 (percent) * 100 (2dp).
  const feeCents = Math.round((grossCents * Math.round(Number(feePercent) * 100)) / 10000);
  return { gross: fromCents(grossCents), fee: fromCents(feeCents), net: fromCents(grossCents - feeCents) };
}

export function toCents(amount: string): number {
  const match = amount.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error(`Invalid money amount: ${amount}`);
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

export function fromCents(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
