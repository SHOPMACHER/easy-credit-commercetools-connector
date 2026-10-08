import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { readConfiguration } from '../../src/utils/config.utils';

describe('readConfiguration', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])('should use the defaults if the optional variables are %s', (_, value) => {
    process.env.BILL_PAYMENT_ENABLED = value;
    process.env.WEBSHOP_CACHE_TTL = value;
    if (value === undefined) {
      delete process.env.BILL_PAYMENT_ENABLED;
      delete process.env.WEBSHOP_CACHE_TTL;
    }

    const { easyCredit } = readConfiguration();

    expect(easyCredit.billPaymentEnabled).toBe('0');
    expect(easyCredit.webshopCacheTtl).toBe('300');
  });

  it.each(['2', 'x', 'true'])('should reject BILL_PAYMENT_ENABLED=%s', (value) => {
    process.env.BILL_PAYMENT_ENABLED = value;

    expect(() => readConfiguration()).toThrow('InvalidBillPaymentEnabled');
  });

  it.each(['-1', '3601', '1.5', 'abc'])('should reject WEBSHOP_CACHE_TTL=%s', (value) => {
    process.env.WEBSHOP_CACHE_TTL = value;

    expect(() => readConfiguration()).toThrow('InvalidWebshopCacheTtl');
  });

  it.each(['0', '3600'])('should accept WEBSHOP_CACHE_TTL=%s', (value) => {
    process.env.WEBSHOP_CACHE_TTL = value;

    expect(readConfiguration().easyCredit.webshopCacheTtl).toBe(value);
  });
});
