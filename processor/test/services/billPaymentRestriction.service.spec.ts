import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Cart } from '@commercetools/connect-payments-sdk';
import {
  getBillPaymentExclusion,
  resetBillPaymentRestrictionCache,
} from '../../src/services/billPaymentRestriction.service';
import { getProductTypesByKeys } from '../../src/commercetools/productType.commercetools';
import { log } from '../../src/libs/logger';

jest.mock('../../src/commercetools/productType.commercetools');

const lineItem = (productTypeId: string) => ({ productType: { typeId: 'product-type', id: productTypeId } });

const buildCart = ({ lineItems = [] as object[], customLineItems = [] as object[] } = {}) =>
  ({ id: 'cart123', lineItems, customLineItems }) as unknown as Cart;

const productTypes = (...types: { id: string; key?: string }[]) =>
  types as Awaited<ReturnType<typeof getProductTypesByKeys>>;

describe('getBillPaymentExclusion', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    resetBillPaymentRestrictionCache();
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

    await expect(getBillPaymentExclusion(cart)).resolves.toEqual({
      productTypeKeys: ['voucher', 'gift-card'],
      customLineItems: [],
    });
    expect(getProductTypesByKeys).toHaveBeenCalledWith(['voucher', 'gift-card']);
  });

  it('should not exclude a cart with only physical products', async () => {
    await expect(getBillPaymentExclusion(buildCart({ lineItems: [lineItem('pt-physical')] }))).resolves.toEqual({
      productTypeKeys: [],
      customLineItems: [],
    });
  });

  it.each([
    ['slug', [{ slug: 'voucher-item' }], ['voucher-item']],
    ['key', [{ slug: 'other', key: 'voucher-item' }], ['other']],
  ])('should match custom line items by %s and return their slugs', async (_, customLineItems, expected) => {
    await expect(getBillPaymentExclusion(buildCart({ customLineItems }))).resolves.toEqual({
      productTypeKeys: [],
      customLineItems: expected,
    });
  });

  it('should not match other custom line items', async () => {
    const cart = buildCart({ customLineItems: [{ slug: 'shipping-fee' }, { slug: 'other', key: 'service' }] });

    await expect(getBillPaymentExclusion(cart)).resolves.toEqual({ productTypeKeys: [], customLineItems: [] });
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

    await getBillPaymentExclusion(buildCart(items));

    expect(getProductTypesByKeys).not.toHaveBeenCalled();
  });

  it('should cache the product types for the webshop cache TTL', async () => {
    jest.useFakeTimers({ now: 0 });
    const cart = buildCart({ lineItems: [lineItem('pt-voucher')] });

    await getBillPaymentExclusion(cart);
    jest.setSystemTime(299_999);
    await getBillPaymentExclusion(cart);
    expect(getProductTypesByKeys).toHaveBeenCalledTimes(1);

    jest.setSystemTime(300_000);
    await getBillPaymentExclusion(cart);
    expect(getProductTypesByKeys).toHaveBeenCalledTimes(2);
  });

  it('should warn about configured product types that do not exist and still exclude the known ones', async () => {
    jest.mocked(getProductTypesByKeys).mockResolvedValue(productTypes({ id: 'pt-voucher', key: 'voucher' }));

    await expect(getBillPaymentExclusion(buildCart({ lineItems: [lineItem('pt-voucher')] }))).resolves.toEqual({
      productTypeKeys: ['voucher'],
      customLineItems: [],
    });
    expect(log.warn).toHaveBeenCalledWith('Bill payment excluded product types do not exist', {
      productTypeKeys: ['gift-card'],
    });
  });

  it('should not cache a result with unknown product types', async () => {
    const cart = buildCart({ lineItems: [lineItem('pt-gift')] });
    jest.mocked(getProductTypesByKeys).mockResolvedValueOnce(productTypes({ id: 'pt-voucher', key: 'voucher' }));

    await expect(getBillPaymentExclusion(cart)).resolves.toEqual({ productTypeKeys: [], customLineItems: [] });
    await expect(getBillPaymentExclusion(cart)).resolves.toEqual({
      productTypeKeys: ['gift-card'],
      customLineItems: [],
    });
    expect(getProductTypesByKeys).toHaveBeenCalledTimes(2);
  });

  it('should not cache a failed lookup', async () => {
    const cart = buildCart({ lineItems: [lineItem('pt-voucher')] });
    jest.mocked(getProductTypesByKeys).mockRejectedValueOnce(new Error('insufficient_scope'));

    await expect(getBillPaymentExclusion(cart)).rejects.toThrow('insufficient_scope');
    await expect(getBillPaymentExclusion(cart)).resolves.toEqual({
      productTypeKeys: ['voucher'],
      customLineItems: [],
    });
  });
});
