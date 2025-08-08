import { getCartById, getCartByPaymentId, updateCart } from '../../src/commercetools/cart.commercetools';
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

  describe('getCartByPaymentId', () => {
    const mockCart = {
      id: 'cart123',
      version: 1,
      paymentInfo: {
        payments: [{ id: 'payment123' }],
      },
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should successfully fetch a cart by paymentId', async () => {
      const mockResponse = {
        body: {
          count: 1,
          results: [mockCart],
        },
      };

      (createApiRoot as jest.Mock).mockReturnValue({
        carts: () => ({
          get: () => ({
            execute: jest.fn().mockResolvedValue(mockResponse),
          }),
        }),
      });

      const result = await getCartByPaymentId('payment123');
      expect(result).toEqual(mockCart);
    });

    it('should throw CartNotFound error when no cart is found', async () => {
      const mockResponse = {
        body: {
          count: 0,
          results: [],
        },
      };

      (createApiRoot as jest.Mock).mockReturnValue({
        carts: () => ({
          get: () => ({
            execute: jest.fn().mockResolvedValue(mockResponse),
          }),
        }),
      });

      await expect(getCartByPaymentId('invalidPaymentId')).rejects.toThrow(Errorx);
      await expect(getCartByPaymentId('invalidPaymentId')).rejects.toThrow('Cart not found.');
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
});
