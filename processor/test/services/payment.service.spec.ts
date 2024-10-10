import { handleGetEasyCreditPaymentMethod } from '../../src/services/payment.service';
import { Cart, Errorx, MultiErrorx } from '@commercetools/connect-payments-sdk';
import { describe, expect, it, jest } from '@jest/globals';
import { getCartById } from '../../src/commercetools/cart.commercetools';
import { MAX_CART_AMOUNT, MIN_CART_AMOUNT } from '../../src/utils/constant.utils';
import { readConfiguration } from '../../src/utils/config.utils';
import { compareAddress } from '../../src/utils/commerceTools.utils';

const cart: Cart = {
  id: '5307942b-38b4-4cbc-95f5-c3ce2e386dd212312',
  version: 1,
  lineItems: [],
  customLineItems: [],
  totalPrice: {
    type: 'centPrecision',
    currencyCode: 'GBP',
    centAmount: 100000000,
    fractionDigits: 2,
  },
  taxMode: '',
  taxRoundingMode: '',
  taxCalculationMode: '',
  inventoryMode: '',
  cartState: '',
  shippingMode: '',
  shipping: [],
  itemShippingAddresses: [],
  discountCodes: [],
  directDiscounts: [],
  refusedGifts: [],
  origin: '',
  createdAt: '',
  lastModifiedAt: '',
};

const validCart: Cart = {
  id: '5307942b-38b4-4cbc-95f5-c3ce2e386dd2123',
  version: 1,
  lineItems: [],
  customLineItems: [],
  totalPrice: {
    type: 'centPrecision',
    currencyCode: 'EUR',
    centAmount: 100000,
    fractionDigits: 2,
  },
  billingAddress: {
    firstName: 'john',
    lastName: 'doe',
    streetName: 'dummy',
    country: 'DE',
    city: 'lorem',
  },
  shippingAddress: {
    firstName: 'john',
    lastName: 'doe',
    streetName: 'dummy',
    country: 'DE',
    city: 'lorem',
  },
  taxMode: '',
  taxRoundingMode: '',
  taxCalculationMode: '',
  inventoryMode: '',
  cartState: '',
  shippingMode: '',
  shipping: [],
  itemShippingAddresses: [],
  discountCodes: [],
  directDiscounts: [],
  refusedGifts: [],
  origin: '',
  createdAt: '',
  lastModifiedAt: '',
};

jest.mock('../../src/commercetools/cart.commercetools.ts', () => ({
  getCartById: jest.fn(),
}));
describe('test handleGetEasyCreditPaymentMethod', () => {
  it('should return only webshopId when all validation has passed', async () => {
    (getCartById as jest.Mock).mockResolvedValue(validCart as never);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    jest.spyOn(require('../../src/utils/config.utils'), 'readConfiguration');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    jest.spyOn(require('../../src/utils/commerceTools.utils'), 'compareAddress');
    const result = await handleGetEasyCreditPaymentMethod(validCart.id);

    expect(readConfiguration).toBeCalledTimes(1);
    expect(getCartById).toBeCalledTimes(1);
    expect(getCartById).toBeCalledWith(validCart.id);
    expect(compareAddress).toBeCalledWith(validCart.billingAddress, validCart.shippingAddress);
    expect(compareAddress).toBeTruthy();
    expect(result).toStrictEqual({
      webShopId: process.env.WEBSHOP_ID,
    });
  });

  it('should return all the existing errors', async () => {
    (getCartById as jest.Mock).mockResolvedValue(cart as never);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    jest.spyOn(require('../../src/utils/config.utils'), 'readConfiguration');
    try {
      await handleGetEasyCreditPaymentMethod(cart.id);
    } catch (error) {
      expect(readConfiguration).toBeCalledTimes(1);
      expect(getCartById).toBeCalledTimes(1);
      expect(getCartById).toBeCalledWith(cart.id);
      expect(error).toBeInstanceOf(MultiErrorx);

      const ecConfig = {
        webShopId: process.env.WEBSHOP_ID,
      };

      const errors = new MultiErrorx([
        new Errorx({
          code: 'InvalidBillingAddress',
          httpErrorStatus: 400,
          message: `Rechnungsadresse kann nicht gefunden werden.`,
          fields: ecConfig,
        }),
        new Errorx({
          code: 'InvalidShippingAddress',
          httpErrorStatus: 400,
          message: `Lieferadresse kann nicht gefunden werden.`,
          fields: ecConfig,
        }),
        new Errorx({
          code: 'AddressesUnmatched',
          httpErrorStatus: 400,
          message: `Liefer- und Rechnungsadresse sind identisch und in Deutschland.`,
          fields: ecConfig,
        }),
        new Errorx({
          code: 'InvalidCurrency',
          httpErrorStatus: 400,
          message: `Die einzige verfügbare Währungsoption ist EUR.`,
          fields: ecConfig,
        }),
        new Errorx({
          code: 'InvalidAmount',
          httpErrorStatus: 400,
          message: `Summe des Warenkorbs beträgt zwischen ${MIN_CART_AMOUNT.toLocaleString()}€ und ${MAX_CART_AMOUNT.toLocaleString()}€.`,
          fields: ecConfig,
        }),
      ]);

      expect(error).toStrictEqual(errors);
    }
  });
});
