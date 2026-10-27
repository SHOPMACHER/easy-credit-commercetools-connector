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

  it.each([
    ['unset', undefined, []],
    ['empty', '', []],
    ['a list with spaces, empty entries and duplicates', ' voucher, ,gift-card,voucher ', ['voucher', 'gift-card']],
  ])('should parse the bill payment exclusion lists if %s', (_, value, expected) => {
    process.env.BILL_PAYMENT_EXCLUDED_PRODUCT_TYPES = value;
    process.env.BILL_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS = value;
    if (value === undefined) {
      delete process.env.BILL_PAYMENT_EXCLUDED_PRODUCT_TYPES;
      delete process.env.BILL_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS;
    }

    const { easyCredit } = readConfiguration();

    expect(easyCredit.billPaymentExcludedProductTypes).toEqual(expected);
    expect(easyCredit.billPaymentExcludedCustomLineItems).toEqual(expected);
  });

  it.each([
    ['BILL_PAYMENT_EXCLUDED_PRODUCT_TYPES', 'InvalidBillPaymentExcludedProductTypes'],
    ['BILL_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS', 'InvalidBillPaymentExcludedCustomLineItems'],
  ])('should reject an invalid entry in %s', (name, code) => {
    process.env[name] = 'voucher,gift card';

    expect(() => readConfiguration()).toThrow(code);
  });
});
