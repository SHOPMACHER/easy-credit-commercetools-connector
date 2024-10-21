import { getCartById, updateCart, unfreezeCartById } from '../../src/commercetools/cart.commercetools';
import { createApiRoot } from '../../src/client/create.client';
import { log } from '../../src/libs/logger';
import { Errorx } from '@commercetools/connect-payments-sdk';
import { CartUpdateAction } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/cart';

jest.mock('../../src/client/create.client');
jest.mock('../../src/libs/logger');

describe('Cart Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getCartById', () => {
    const cartId = 'cart123';

    it('should successfully fetch a cart by ID and return the cart object', async () => {
      const mockResponse = { body: { id: cartId, totalPrice: { centAmount: 10000 } } };

      (createApiRoot as jest.Mock).mockReturnValue({
        carts: () => ({
          withId: () => ({
            get: () => ({
              execute: jest.fn().mockResolvedValue(mockResponse),
            }),
          }),
        }),
      });

      const result = await getCartById(cartId);

      expect(result).toEqual(mockResponse.body);
      expect(createApiRoot).toHaveBeenCalled();
    });

    it('should log an error and throw an Errorx if the request fails', async () => {
      const errorResponse = {
        code: 'NotFoundError',
        body: { message: 'Cart not found', errors: [{ field: 'id', message: 'Invalid cart ID' }] },
        statusCode: 404,
      };

      (createApiRoot as jest.Mock).mockReturnValue({
        carts: () => ({
          withId: () => ({
            get: () => ({
              execute: jest.fn().mockRejectedValue(errorResponse),
            }),
          }),
        }),
      });

      await expect(getCartById(cartId)).rejects.toThrow(Errorx);
      expect(log.error).toHaveBeenCalledWith('Error in getting CommerceTools Cart', errorResponse);
    });
  });

  describe('updateCart', () => {
    const cart = {
      id: 'cart123',
      version: 1,
      cartState: 'Active',
      totalPrice: {
        centAmount: 10000,
        currencyCode: 'EUR',
        fractionDigits: 2,
      },
      billingAddress: {
        firstName: 'John',
        lastName: 'Doe',
        country: 'DE',
      },
      shippingAddress: {
        firstName: 'John',
        lastName: 'Doe',
        country: 'DE',
      },
      lineItems: [
        {
          id: 'lineItem123',
          quantity: 2,
          price: {
            centAmount: 5000,
            currencyCode: 'EUR',
          },
        },
      ],
    };
    const updateActions: CartUpdateAction[] = [
      { action: 'changeLineItemQuantity', lineItemId: 'lineItem123', quantity: 2 },
    ];

    it('should successfully update the cart and return the updated cart object', async () => {
      const mockResponse = { body: { id: cart.id, version: 2, lineItems: [{ id: 'lineItem123', quantity: 2 }] } };

      (createApiRoot as jest.Mock).mockReturnValue({
        carts: () => ({
          withId: () => ({
            post: () => ({
              execute: jest.fn().mockResolvedValue(mockResponse),
            }),
          }),
        }),
      });

      // @ts-expect-error test
      const result = await updateCart(cart, updateActions);

      expect(result).toEqual(mockResponse.body);
      expect(createApiRoot).toHaveBeenCalled();
    });

    it('should log an error and throw an Errorx if the update request fails', async () => {
      const errorResponse = {
        code: 'UpdateError',
        body: { message: 'Update failed', errors: [{ field: 'version', message: 'Version mismatch' }] },
        statusCode: 409,
      };

      (createApiRoot as jest.Mock).mockReturnValue({
        carts: () => ({
          withId: () => ({
            post: () => ({
              execute: jest.fn().mockRejectedValue(errorResponse),
            }),
          }),
        }),
      });

      // @ts-expect-error test
      await expect(updateCart(cart, updateActions)).rejects.toThrow(Errorx);
      expect(log.error).toHaveBeenCalledWith('Error in updatePayment', errorResponse);
    });
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

  describe('updateCart', () => {
    it('should throw an error if no payments are found for the paymentId', async () => {
      const paymentId = 'payment-id-no-payments';

      // Mock the response for carts().get() with an empty array for results
      const cartsMock = jest.fn();
      (createApiRoot as jest.Mock).mockImplementation(() => ({
        carts: jest.fn().mockImplementation(() => ({
          get: cartsMock,
        })),
      }));

      cartsMock.mockImplementation(() => ({
        execute: jest.fn().mockResolvedValue({
          body: {
            count: 0,
            results: [],
          },
        }),
      }));

      // Test for the case when no payments are found
      await expect(unfreezeCartById(paymentId)).rejects.toThrow(Errorx);

      expect(log.error).toHaveBeenCalledWith(
          'Error in unfreezing CommerceTools Cart',
          expect.anything() // Matching any dynamic error
      );
    });

    it('should handle a network error during cart retrieval', async () => {
      const paymentId = 'payment-id-123';

      // Simulate a network error from carts().get()
      const cartsMock = jest.fn();
      (createApiRoot as jest.Mock).mockImplementation(() => ({
        carts: jest.fn().mockImplementation(() => ({
          get: cartsMock,
        })),
      }));

      cartsMock.mockImplementation(() => ({
        execute: jest.fn().mockRejectedValue(new Error('Network error')),
      }));

      await expect(unfreezeCartById(paymentId)).rejects.toThrow(Errorx);

      expect(log.error).toHaveBeenCalledWith(
          'Error in unfreezing CommerceTools Cart',
          expect.anything()
      );
    });

    it('should handle a cart version conflict during the unfreeze action', async () => {
      const mockCartId = 'cart-id-123';
      const mockCartVersion = 1;
      const paymentId = 'payment-id-123';

      // Mock the responses for API carts and getCartById
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
        execute: jest.fn().mockResolvedValue({
          body: {
            count: 1,
            results: [{ id: mockCartId }],
          },
        }),
      }));

      // Simulate a version conflict error during the unfreeze action
      postMock.mockImplementation(() => ({
        execute: jest.fn().mockRejectedValue({
          code: 'VersionConflict',
          body: { message: 'Version mismatch', errors: [{ field: 'version', message: 'Outdated version' }] },
          statusCode: 409,
        }),
      }));

      // Spy on getCartById to use the mock
      jest.spyOn(require('../../src/commercetools/cart.commercetools'), 'getCartById').mockImplementation(getCartByIdMock);

      await expect(unfreezeCartById(paymentId)).rejects.toThrow(Errorx);

      expect(log.error).toHaveBeenCalledWith(
          'Error in unfreezing CommerceTools Cart',
          expect.anything() // Matching any dynamic error
      );
    });
  });
});
