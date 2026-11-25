import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { getPaymentTypeConfig, readConfiguration } from '../../src/utils/config.utils';
import { ECTransactionPaymentType } from '../../src/types/payment.types';

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
    process.env.INSTALLMENT_PAYMENT_ENABLED = value;
    if (value === undefined) {
      delete process.env.BILL_PAYMENT_ENABLED;
      delete process.env.WEBSHOP_CACHE_TTL;
      delete process.env.INSTALLMENT_PAYMENT_ENABLED;
    }

    const { easyCredit } = readConfiguration();

    expect(easyCredit.billPaymentEnabled).toBe('0');
    expect(easyCredit.installmentPaymentEnabled).toBe('1');
    expect(easyCredit.installmentPaymentExcludedProductTypes).toEqual([]);
    expect(easyCredit.installmentPaymentExcludedCustomLineItems).toEqual([]);
    expect(easyCredit.webshopCacheTtl).toBe('300');
  });

  it.each(['2', 'x', 'true'])('should reject BILL_PAYMENT_ENABLED=%s', (value) => {
    process.env.BILL_PAYMENT_ENABLED = value;

    expect(() => readConfiguration()).toThrow('InvalidBillPaymentEnabled');
  });

  it.each(['2', 'x', 'true'])('should reject INSTALLMENT_PAYMENT_ENABLED=%s', (value) => {
    process.env.INSTALLMENT_PAYMENT_ENABLED = value;

    expect(() => readConfiguration()).toThrow('InvalidInstallmentPaymentEnabled');
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
    ['INSTALLMENT_PAYMENT_EXCLUDED_PRODUCT_TYPES', 'InvalidInstallmentPaymentExcludedProductTypes'],
    ['INSTALLMENT_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS', 'InvalidInstallmentPaymentExcludedCustomLineItems'],
  ])('should reject an invalid entry in %s', (name, code) => {
    process.env[name] = 'voucher,gift card';

    expect(() => readConfiguration()).toThrow(code);
  });

  it.each([
    [undefined, []],
    ['', []],
    ['Shop.Example.com, www.shop.example.com,localhost', ['shop.example.com', 'www.shop.example.com', 'localhost']],
  ])('should read REDIRECT_ALLOWED_HOSTS=%s as lowercase host names', (value, expected) => {
    process.env.REDIRECT_ALLOWED_HOSTS = value;
    if (value === undefined) {
      delete process.env.REDIRECT_ALLOWED_HOSTS;
    }

    expect(readConfiguration().easyCredit.redirectAllowedHosts).toEqual(expected);
  });

  it.each(['https://shop.example.com', 'shop.example.com/cart', 'shop.example.com:443', 'shop example.com'])(
    'should reject REDIRECT_ALLOWED_HOSTS=%s',
    (value) => {
      process.env.REDIRECT_ALLOWED_HOSTS = value;

      expect(() => readConfiguration()).toThrow('InvalidRedirectAllowedHosts');
    },
  );

  it('should read the settings of each payment type from its own variables', () => {
    process.env.INSTALLMENT_PAYMENT_ENABLED = '0';
    process.env.INSTALLMENT_PAYMENT_EXCLUDED_PRODUCT_TYPES = 'gift-card';
    process.env.INSTALLMENT_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS = 'gift-wrap';
    process.env.BILL_PAYMENT_ENABLED = '1';
    process.env.BILL_PAYMENT_EXCLUDED_PRODUCT_TYPES = 'voucher';
    process.env.BILL_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS = 'voucher-item';
    const { easyCredit } = readConfiguration();

    expect(getPaymentTypeConfig(easyCredit, ECTransactionPaymentType.ECTransactionInstallmentPayment)).toEqual({
      enabled: false,
      excludedProductTypes: ['gift-card'],
      excludedCustomLineItems: ['gift-wrap'],
    });
    expect(getPaymentTypeConfig(easyCredit, ECTransactionPaymentType.ECTransactionBillPayment)).toEqual({
      enabled: true,
      excludedProductTypes: ['voucher'],
      excludedCustomLineItems: ['voucher-item'],
    });
  });
});
