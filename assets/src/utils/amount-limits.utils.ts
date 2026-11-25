import { PaymentType } from '../types/main';

export type AmountLimits = { minAmount: number; maxAmount: number };
export type AmountLimitsByType = Partial<Record<PaymentType, AmountLimits>>;

// Only the limits the merchant narrowed are sent; easyCredit applies its own limits.
export function isWithinAmountLimits(amount: unknown, limits?: AmountLimits): boolean {
  // Plain JS storefronts may pass a numeric string. An amount that can't be checked fails closed.
  const value = Number(amount);

  return !limits || (Number.isFinite(value) && value >= limits.minAmount && value <= limits.maxAmount);
}

export function filterByAmountLimits(
  paymentTypes: PaymentType[],
  amount: unknown,
  limits?: AmountLimitsByType,
): PaymentType[] {
  return paymentTypes.filter((paymentType) => isWithinAmountLimits(amount, limits?.[paymentType]));
}
