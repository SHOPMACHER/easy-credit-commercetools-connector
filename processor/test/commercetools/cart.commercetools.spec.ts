import { Cart } from '@commercetools/connect-payments-sdk';
import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { createApiRoot } from '../../src/client/create.client';
import { getCartById } from '../../src/commercetools/cart.commercetools';

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

jest.mock('../../src/client/create.client', () => ({
  createApiRoot: jest.fn(),
}));

describe('Test cart.commercetools', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should able to call getCartById', async () => {
    const getCartByIdMock = jest.fn();

    (createApiRoot as jest.Mock).mockImplementation(() => ({
      carts: jest.fn().mockImplementation(() => ({
        withId: getCartByIdMock,
      })),
    }));

    getCartByIdMock.mockImplementation(() => ({
      get: jest.fn().mockImplementation(() => ({
        execute: jest.fn().mockReturnValue({
          body: validCart,
        }),
      })),
    }));

    const result = await getCartById(validCart.id);

    expect(getCartByIdMock).toHaveBeenCalledTimes(1);
    expect(getCartByIdMock).toHaveBeenCalledWith({ ID: validCart.id });
    expect(result).toStrictEqual(validCart);
  });
});
