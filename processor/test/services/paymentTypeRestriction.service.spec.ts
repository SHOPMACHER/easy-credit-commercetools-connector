import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Cart } from '@commercetools/connect-payments-sdk';
import {
  getPaymentTypeExclusion,
  resetPaymentTypeRestrictionCache,
} from '../../src/services/paymentTypeRestriction.service';
import { getProductTypesByKeys } from '../../src/commercetools/productType.commercetools';
import { log } from '../../src/libs/logger';
import { ECTransactionPaymentType } from '../../src/types/payment.types';

const BILL = ECTransactionPaymentType.ECTransactionBillPayment;
const INSTALLMENT = ECTransactionPaymentType.ECTransactionInstallmentPayment;

jest.mock('../../src/commercetools/productType.commercetools');

const lineItem = (productTypeId: string) => ({ productType: { typeId: 'product-type', id: productTypeId } });

const buildCart = ({ lineItems = [] as object[], customLineItems = [] as object[] } = {}) =>
  ({ id: 'cart123', lineItems, customLineItems }) as unknown as Cart;

const productTypes = (...types: { id: string; key?: string }[]) =>
  types as Awaited<ReturnType<typeof getProductTypesByKeys>>;

describe('getPaymentTypeExclusion', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    resetPaymentTypeRestrictionCache();
    process.env.BILL_PAYMENT_EXCLUDED_PRODUCT_TYPES = 'voucher,gift-card';
    process.env.BILL_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS = 'voucher-item';
    process.env.WEBSHOP_CACHE_TTL = '300';
    jest
      .mocked(getProductTypesByKeys)
      .mockResolvedValue(productTypes({ id: 'pt-voucher', key: 'voucher' }, { id: 'pt-gift', key: 'gift-card' }));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.useRealTimers();
  });

  it('should return the keys of excluded product types once each', async () => {
    const cart = buildCart({
      lineItems: [lineItem('pt-physical'), lineItem('pt-voucher'), lineItem('pt-voucher'), lineItem('pt-gift')],
    });

    await expect(getPaymentTypeExclusion(cart, BILL)).resolves.toEqual({
      productTypeKeys: ['voucher', 'gift-card'],
      customLineItems: [],
    });
    expect(getProductTypesByKeys).toHaveBeenCalledWith(['voucher', 'gift-card']);
  });

  it('should not exclude a cart with only physical products', async () => {
    await expect(getPaymentTypeExclusion(buildCart({ lineItems: [lineItem('pt-physical')] }), BILL)).resolves.toEqual({
      productTypeKeys: [],
      customLineItems: [],
    });
  });

  it.each([
    ['slug', [{ slug: 'voucher-item' }], ['voucher-item']],
    ['key', [{ slug: 'other', key: 'voucher-item' }], ['other']],
  ])('should match custom line items by %s and return their slugs', async (_, customLineItems, expected) => {
    await expect(getPaymentTypeExclusion(buildCart({ customLineItems }), BILL)).resolves.toEqual({
      productTypeKeys: [],
      customLineItems: expected,
    });
  });

  it('should not match other custom line items', async () => {
    const cart = buildCart({ customLineItems: [{ slug: 'shipping-fee' }, { slug: 'other', key: 'service' }] });

    await expect(getPaymentTypeExclusion(cart, BILL)).resolves.toEqual({ productTypeKeys: [], customLineItems: [] });
  });

  it.each([
    [
      'no product types are configured',
      () => delete process.env.BILL_PAYMENT_EXCLUDED_PRODUCT_TYPES,
      { lineItems: [lineItem('pt-voucher')] },
    ],
    ['the cart has no line items', () => undefined, {}],
    [
      'a custom line item already excludes the cart',
      () => undefined,
      { lineItems: [lineItem('pt-voucher')], customLineItems: [{ slug: 'voucher-item' }] },
    ],
  ])('should not load product types if %s', async (_, setup, items) => {
    setup();

    await getPaymentTypeExclusion(buildCart(items), BILL);

    expect(getProductTypesByKeys).not.toHaveBeenCalled();
  });

  it('should cache the product types for the webshop cache TTL', async () => {
    jest.useFakeTimers({ now: 0 });
    const cart = buildCart({ lineItems: [lineItem('pt-voucher')] });

    await getPaymentTypeExclusion(cart, BILL);
    jest.setSystemTime(299_999);
    await getPaymentTypeExclusion(cart, BILL);
    expect(getProductTypesByKeys).toHaveBeenCalledTimes(1);

    jest.setSystemTime(300_000);
    await getPaymentTypeExclusion(cart, BILL);
    expect(getProductTypesByKeys).toHaveBeenCalledTimes(2);
  });

  it('should warn about configured product types that do not exist and still exclude the known ones', async () => {
    jest.mocked(getProductTypesByKeys).mockResolvedValue(productTypes({ id: 'pt-voucher', key: 'voucher' }));

    await expect(getPaymentTypeExclusion(buildCart({ lineItems: [lineItem('pt-voucher')] }), BILL)).resolves.toEqual({
      productTypeKeys: ['voucher'],
      customLineItems: [],
    });
    expect(log.warn).toHaveBeenCalledWith('Excluded product types do not exist', {
      paymentType: BILL,
      productTypeKeys: ['gift-card'],
    });
  });

  it('should not cache a result with unknown product types', async () => {
    const cart = buildCart({ lineItems: [lineItem('pt-gift')] });
    jest.mocked(getProductTypesByKeys).mockResolvedValueOnce(productTypes({ id: 'pt-voucher', key: 'voucher' }));

    await expect(getPaymentTypeExclusion(cart, BILL)).resolves.toEqual({ productTypeKeys: [], customLineItems: [] });
    await expect(getPaymentTypeExclusion(cart, BILL)).resolves.toEqual({
      productTypeKeys: ['gift-card'],
      customLineItems: [],
    });
    expect(getProductTypesByKeys).toHaveBeenCalledTimes(2);
  });

  it('should not cache a failed lookup', async () => {
    const cart = buildCart({ lineItems: [lineItem('pt-voucher')] });
    jest.mocked(getProductTypesByKeys).mockRejectedValueOnce(new Error('insufficient_scope'));

    await expect(getPaymentTypeExclusion(cart, BILL)).rejects.toThrow('insufficient_scope');
    await expect(getPaymentTypeExclusion(cart, BILL)).resolves.toEqual({
      productTypeKeys: ['voucher'],
      customLineItems: [],
    });
  });
  describe('per payment type', () => {
    beforeEach(() => {
      process.env.INSTALLMENT_PAYMENT_EXCLUDED_PRODUCT_TYPES = 'gift-card';
      process.env.INSTALLMENT_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS = 'gift-wrap';
    });

    it('should use the installment lists for installment', async () => {
      jest.mocked(getProductTypesByKeys).mockResolvedValue(productTypes({ id: 'pt-gift', key: 'gift-card' }));
      const cart = buildCart({ lineItems: [lineItem('pt-voucher'), lineItem('pt-gift')] });

      await expect(getPaymentTypeExclusion(cart, INSTALLMENT)).resolves.toEqual({
        productTypeKeys: ['gift-card'],
        customLineItems: [],
      });
      expect(getProductTypesByKeys).toHaveBeenCalledWith(['gift-card']);
    });

    it('should match a custom line item only for the type that lists it', async () => {
      const cart = buildCart({ customLineItems: [{ slug: 'voucher-item' }] });

      await expect(getPaymentTypeExclusion(cart, INSTALLMENT)).resolves.toEqual({
        productTypeKeys: [],
        customLineItems: [],
      });
      await expect(getPaymentTypeExclusion(cart, BILL)).resolves.toEqual({
        productTypeKeys: [],
        customLineItems: ['voucher-item'],
      });
    });

    it('should not exclude anything for installment without configured lists', async () => {
      delete process.env.INSTALLMENT_PAYMENT_EXCLUDED_PRODUCT_TYPES;
      delete process.env.INSTALLMENT_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS;
      const cart = buildCart({ lineItems: [lineItem('pt-voucher')], customLineItems: [{ slug: 'gift-wrap' }] });

      await expect(getPaymentTypeExclusion(cart, INSTALLMENT)).resolves.toEqual({
        productTypeKeys: [],
        customLineItems: [],
      });
      expect(getProductTypesByKeys).not.toHaveBeenCalled();
    });

    it('should cache the product types of each type separately', async () => {
      const cart = buildCart({ lineItems: [lineItem('pt-gift')] });
      jest
        .mocked(getProductTypesByKeys)
        .mockImplementation(async (keys) =>
          productTypes(...keys.map((key) => ({ id: key === 'voucher' ? 'pt-voucher' : 'pt-gift', key }))),
        );

      await getPaymentTypeExclusion(cart, BILL);
      await getPaymentTypeExclusion(cart, INSTALLMENT);
      await getPaymentTypeExclusion(cart, BILL);
      await getPaymentTypeExclusion(cart, INSTALLMENT);

      expect(getProductTypesByKeys).toHaveBeenCalledTimes(2);
      expect(getProductTypesByKeys).toHaveBeenCalledWith(['voucher', 'gift-card']);
      expect(getProductTypesByKeys).toHaveBeenCalledWith(['gift-card']);
    });
  });
});
