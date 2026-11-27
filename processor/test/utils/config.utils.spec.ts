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

  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])('should default WIDGET_VISIBILITY to PDP_AND_CART if it is %s', (_, value) => {
    process.env.WIDGET_VISIBILITY = value;
    if (value === undefined) {
      delete process.env.WIDGET_VISIBILITY;
    }

    expect(readConfiguration().easyCredit.widgetVisibility).toBe('PDP_AND_CART');
  });

  it.each(['PDP_AND_CART', 'PDP', 'CART'])('should read WIDGET_VISIBILITY=%s', (value) => {
    process.env.WIDGET_VISIBILITY = value;

    expect(readConfiguration().easyCredit.widgetVisibility).toBe(value);
  });

  it.each(['NONE', 'pdp'])('should reject WIDGET_VISIBILITY=%s', (value) => {
    process.env.WIDGET_VISIBILITY = value;

    expect(() => readConfiguration()).toThrow('InvalidWidgetVisibility');
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
      amountLimits: {},
      invalidAmountLimits: false,
    });
    expect(getPaymentTypeConfig(easyCredit, ECTransactionPaymentType.ECTransactionBillPayment)).toEqual({
      enabled: true,
      excludedProductTypes: ['voucher'],
      excludedCustomLineItems: ['voucher-item'],
      amountLimits: {},
      invalidAmountLimits: false,
    });
  });

  describe('merchant amount limits', () => {
    const limitsOf = (paymentType: ECTransactionPaymentType) => {
      const { amountLimits, invalidAmountLimits } = getPaymentTypeConfig(readConfiguration().easyCredit, paymentType);
      return { amountLimits, invalidAmountLimits };
    };

    it('should read the limits of each payment type from its own variables', () => {
      process.env.INSTALLMENT_PAYMENT_MIN_AMOUNT = '300';
      process.env.INSTALLMENT_PAYMENT_MAX_AMOUNT = '8000';
      process.env.BILL_PAYMENT_MIN_AMOUNT = ' 99.90 ';
      process.env.BILL_PAYMENT_MAX_AMOUNT = '1000.5';

      expect(limitsOf(ECTransactionPaymentType.ECTransactionInstallmentPayment)).toEqual({
        amountLimits: { minAmount: 300, maxAmount: 8000 },
        invalidAmountLimits: false,
      });
      expect(limitsOf(ECTransactionPaymentType.ECTransactionBillPayment)).toEqual({
        amountLimits: { minAmount: 99.9, maxAmount: 1000.5 },
        invalidAmountLimits: false,
      });
    });

    it.each([
      ['unset', undefined],
      ['empty', ''],
    ])('should set no limits if the variables are %s', (_, value) => {
      delete process.env.BILL_PAYMENT_MIN_AMOUNT;
      delete process.env.BILL_PAYMENT_MAX_AMOUNT;
      if (value !== undefined) {
        process.env.BILL_PAYMENT_MIN_AMOUNT = value;
        process.env.BILL_PAYMENT_MAX_AMOUNT = value;
      }

      expect(limitsOf(ECTransactionPaymentType.ECTransactionBillPayment)).toEqual({
        amountLimits: {},
        invalidAmountLimits: false,
      });
    });

    it('should accept only one of the limits', () => {
      process.env.BILL_PAYMENT_MIN_AMOUNT = '100';
      delete process.env.BILL_PAYMENT_MAX_AMOUNT;

      expect(limitsOf(ECTransactionPaymentType.ECTransactionBillPayment)).toEqual({
        amountLimits: { minAmount: 100 },
        invalidAmountLimits: false,
      });
    });

    it.each([
      ['a negative minimum', '-1', '100'],
      ['a non-numeric maximum', '100', 'abc'],
      ['a comma decimal', '100,50', '200'],
      ['more than 2 decimals', '100.123', '200'],
      ['a minimum above the maximum', '500', '100'],
    ])('should drop both limits for %s without failing', (_, min, max) => {
      process.env.INSTALLMENT_PAYMENT_MIN_AMOUNT = min;
      process.env.INSTALLMENT_PAYMENT_MAX_AMOUNT = max;

      expect(limitsOf(ECTransactionPaymentType.ECTransactionInstallmentPayment)).toEqual({
        amountLimits: {},
        invalidAmountLimits: true,
      });
    });
  });

  describe('express button', () => {
    beforeEach(() => {
      delete process.env.EXPRESS_BUTTON_ENABLED;
      delete process.env.EXPRESS_BUTTON_VISIBILITY;
    });

    it('defaults the express button to off and PDP_AND_CART', () => {
      const { easyCredit } = readConfiguration();

      expect(easyCredit.expressButtonEnabled).toBe('0');
      expect(easyCredit.expressButtonVisibility).toBe('PDP_AND_CART');
    });

    it('treats an empty EXPRESS_BUTTON_VISIBILITY as PDP_AND_CART', () => {
      process.env.EXPRESS_BUTTON_VISIBILITY = '';

      expect(readConfiguration().easyCredit.expressButtonVisibility).toBe('PDP_AND_CART');
    });

    it('reads EXPRESS_BUTTON_ENABLED=1 and EXPRESS_BUTTON_VISIBILITY=CART', () => {
      process.env.EXPRESS_BUTTON_ENABLED = '1';
      process.env.EXPRESS_BUTTON_VISIBILITY = 'CART';

      const { easyCredit } = readConfiguration();

      expect(easyCredit.expressButtonEnabled).toBe('1');
      expect(easyCredit.expressButtonVisibility).toBe('CART');
    });

    it('rejects EXPRESS_BUTTON_VISIBILITY=PDP_ONLY', () => {
      process.env.EXPRESS_BUTTON_VISIBILITY = 'PDP_ONLY';

      expect(() => readConfiguration()).toThrow('InvalidExpressButtonVisibility');
    });

    it('rejects EXPRESS_BUTTON_ENABLED=yes', () => {
      process.env.EXPRESS_BUTTON_ENABLED = 'yes';

      expect(() => readConfiguration()).toThrow('InvalidExpressButtonEnabled');
    });
  });
});
