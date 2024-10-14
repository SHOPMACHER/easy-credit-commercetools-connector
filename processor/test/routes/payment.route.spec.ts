import { setupFastify } from '../../src/server/server';
import { describe, jest, it, expect } from '@jest/globals';
import { Cart } from '@commercetools/connect-payments-sdk';
import { getCartById } from '../../src/commercetools/cart.commercetools';
import { paymentSDK } from '../../src/payment-sdk';
import { MAX_CART_AMOUNT, MIN_CART_AMOUNT } from '../../src/utils/constant.utils';
import { getEasyCreditPaymentMethod } from '../../src/controllers/payment.controller';

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

jest.mock('../../src/payment-sdk.ts', () => ({
  paymentSDK: {
    jwtAuthHookFn: jest.fn(),
    oauth2AuthHookFn: jest.fn(),
    sessionHeaderAuthHookFn: {
      authenticate: jest.fn(),
    },
    authorityAuthorizationHookFn: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.spyOn(require('../../src/controllers/payment.controller.ts'), 'getEasyCreditPaymentMethod');

describe('test paymentRoute', () => {
  it('should call getEasyCreditPaymentMethod and return 200 as status with correct body', async () => {
    (getCartById as jest.Mock).mockReturnValue(validCart);

    (paymentSDK.sessionHeaderAuthHookFn.authenticate as unknown as jest.Mock).mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
      return async (request: any, reply: any) => {
        console.log('Mock authenticate called');
      };
    });

    const server = await setupFastify();

    const response = await server.inject({
      method: 'GET',
      url: `/payments/payment-method?cartId=${validCart.id}`,
    });

    expect(getEasyCreditPaymentMethod).toBeCalledTimes(1);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toStrictEqual({
      webShopId: process.env.WEBSHOP_ID,
    });
  });

  it('should call getEasyCreditPaymentMethod and return 400 as status with correct body', async () => {
    (getCartById as jest.Mock).mockReturnValue(cart);

    (paymentSDK.sessionHeaderAuthHookFn.authenticate as unknown as jest.Mock).mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
      return async (request: any, reply: any) => {
        console.log('Mock authenticate called');
      };
    });

    const server = await setupFastify();

    const response = await server.inject({
      method: 'GET',
      url: `/payments/payment-method?cartId=${validCart.id}`,
    });

    const webShopId = process.env.WEBSHOP_ID;
    expect(getEasyCreditPaymentMethod).toBeCalledTimes(1);
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toStrictEqual({
      message: 'Rechnungsadresse kann nicht gefunden werden.',
      statusCode: 400,
      errors: [
        {
          code: 'InvalidBillingAddress',
          message: 'Rechnungsadresse kann nicht gefunden werden.',
          webShopId: webShopId,
        },
        {
          code: 'InvalidShippingAddress',
          message: 'Lieferadresse kann nicht gefunden werden.',
          webShopId: webShopId,
        },
        {
          code: 'AddressesUnmatched',
          message: 'Liefer- und Rechnungsadresse sind nicht identisch oder nicht in Deutschland.',
          webShopId: webShopId,
        },
        {
          code: 'InvalidCurrency',
          message: 'Die einzige verfügbare Währungsoption ist EUR.',
          webShopId: webShopId,
        },
        {
          code: 'InvalidAmount',
          message: `Die Summe des Warenkorbs muss zwischen ${MIN_CART_AMOUNT.toLocaleString()}€ und ${MAX_CART_AMOUNT.toLocaleString()}€ liegen.`,
          webShopId: webShopId,
        },
      ],
    });
  });
});
