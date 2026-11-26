import { describe, expect, it } from '@jest/globals';
import { filterByAmountLimits, isWithinAmountLimits } from '../../src/utils/amount-limits.utils';

const limits = { minAmount: 100, maxAmount: 500 };

describe('isWithinAmountLimits', () => {
  it('passes when there are no limits', () => {
    expect(isWithinAmountLimits(50, undefined)).toBe(true);
  });

  it('fails below the minimum', () => {
    expect(isWithinAmountLimits(50, limits)).toBe(false);
  });

  it('accepts a numeric string', () => {
    expect(isWithinAmountLimits('150', limits)).toBe(true);
  });

  it('fails closed on an amount that is not a number', () => {
    expect(isWithinAmountLimits(NaN, limits)).toBe(false);
  });
});

describe('filterByAmountLimits', () => {
  it('drops the payment types whose limits exclude the amount', () => {
    expect(
      filterByAmountLimits(['INSTALLMENT_PAYMENT', 'BILL_PAYMENT'], 600, {
        BILL_PAYMENT: { minAmount: 0, maxAmount: 500 },
      }),
    ).toEqual(['INSTALLMENT_PAYMENT']);
  });
});
