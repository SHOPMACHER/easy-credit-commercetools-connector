import { describe, expect, it } from '@jest/globals';
import { fromWebComponentPaymentType } from '../../src/utils/payment-type.utils';

describe('fromWebComponentPaymentType', () => {
  it.each([
    ['INSTALLMENT', 'INSTALLMENT_PAYMENT'],
    ['BILL', 'BILL_PAYMENT'],
  ] as const)('maps %s to %s', (webComponentType, paymentType) => {
    expect(fromWebComponentPaymentType(webComponentType)).toBe(paymentType);
  });

  it('returns undefined for an unknown type', () => {
    expect(fromWebComponentPaymentType('UNKNOWN' as 'BILL')).toBeUndefined();
  });
});
