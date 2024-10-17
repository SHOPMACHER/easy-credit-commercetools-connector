import { Cart, Errorx } from '@commercetools/connect-payments-sdk';
import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { log } from '../../src/libs/logger';
import { createApiRoot } from '../../src/client/create.client';
import { getCartById, unfreezeCartById } from '../../src/commercetools/cart.commercetools';

jest.mock('../../src/client/create.client');
jest.mock('../../src/libs/logger');

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

  it('should unfreeze a cart by paymentId successfully', async () => {
    const mockCartId = 'cart-id-123';
    const mockCartVersion = 1;
    const paymentId = 'payment-id-123';

    // Mock responses for API carts and getCartById
    const cartsMock = jest.fn();
    const postMock = jest.fn();
    // @ts-ignore
    const getCartByIdMock = jest.fn().mockResolvedValue({
      id: mockCartId,
      version: mockCartVersion,
    });

    (createApiRoot as jest.Mock).mockImplementation(() => ({
      carts: jest.fn().mockImplementation(() => ({
        get: cartsMock,
        withId: jest.fn().mockReturnValue({
          post: postMock,
        }),
      })),
    }));

    // Mock the response for carts().get()
    cartsMock.mockImplementation(() => ({
      // @ts-ignore
      execute: jest.fn().mockResolvedValue({
        body: {
          count: 1,
          results: [{ id: mockCartId }],
        },
      }),
    }));

    // Mock the response for carts().withId().post()
    postMock.mockImplementation(() => ({
      // @ts-ignore
      execute: jest.fn().mockResolvedValue({
        body: {
          success: true,
        },
      }),
    }));

    // Spy on getCartById to use the mock
    jest.spyOn(require('../../src/commercetools/cart.commercetools'), 'getCartById').mockImplementation(getCartByIdMock);

    const result = await unfreezeCartById(paymentId);

    // Check if the mocks were called correctly
    expect(cartsMock).toHaveBeenCalledTimes(1);
    expect(cartsMock).toHaveBeenCalledWith({
      queryArgs: { where: 'paymentInfo(payments(id="payment-id-123"))', limit: 1 },
    });
    expect(getCartByIdMock).toHaveBeenCalledWith(mockCartId);
    expect(postMock).toHaveBeenCalledWith({
      body: {
        version: mockCartVersion,
        actions: [{ action: 'unfreezeCart' }],
      },
    });

    expect(result).toEqual({ success: true });
  });

  it('should throw an error if no cart is found for the paymentId', async () => {
    const paymentId = 'invalid-payment-id';

    // Mock the response for carts().get() with count = 0
    const cartsMock = jest.fn();
    (createApiRoot as jest.Mock).mockImplementation(() => ({
      carts: jest.fn().mockImplementation(() => ({
        get: cartsMock,
      })),
    }));

    cartsMock.mockImplementation(() => ({
      // @ts-ignore
      execute: jest.fn().mockResolvedValue({
        body: {
          count: 0,
          results: [],
        },
      }),
    }));

    await expect(unfreezeCartById(paymentId)).rejects.toThrow(Errorx);

    expect(log.error).toHaveBeenCalledWith(
        'Error in unfreezing CommerceTools Cart',
        expect.anything() // Since error is dynamic, you can check any error
    );
  });

  it('should throw an error if unfreeze action fails', async () => {
    const mockCartId = 'cart-id-123';
    const mockCartVersion = 1;
    const paymentId = 'payment-id-123';

    // Mock responses for API carts and getCartById
    const cartsMock = jest.fn();
    const postMock = jest.fn();
    // @ts-ignore
    const getCartByIdMock = jest.fn().mockResolvedValue({
      id: mockCartId,
      version: mockCartVersion,
    });

    (createApiRoot as jest.Mock).mockImplementation(() => ({
      carts: jest.fn().mockImplementation(() => ({
        get: cartsMock,
        withId: jest.fn().mockReturnValue({
          post: postMock,
        }),
      })),
    }));

    // Mock the response for carts().get()
    cartsMock.mockImplementation(() => ({
      // @ts-ignore
      execute: jest.fn().mockResolvedValue({
        body: {
          count: 1,
          results: [{ id: mockCartId }],
        },
      }),
    }));

    // Mock error for carts().withId().post()
    postMock.mockImplementation(() => ({
      // @ts-ignore
      execute: jest.fn().mockRejectedValue(new Error('Unfreeze action failed')),
    }));

    // Spy on getCartById to use the mock
    jest.spyOn(require('../../src/commercetools/cart.commercetools'), 'getCartById').mockImplementation(getCartByIdMock);

    await expect(unfreezeCartById(paymentId)).rejects.toThrow(Errorx);

    expect(log.error).toHaveBeenCalledWith(
        'Error in unfreezing CommerceTools Cart',
        expect.anything() // Since error is dynamic, you can check any error
    );
  });
});
