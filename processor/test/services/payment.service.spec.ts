import { handlePaymentMethod, handleCreatePayment, handleAuthorizePayment } from '../../src/services/payment.service';
import { getCartById, updateCart } from '../../src/commercetools/cart.commercetools';
import { createPayment, getPaymentById, updatePayment } from '../../src/commercetools/payment.commercetools';
import { log } from '../../src/libs/logger';
import { Address, MultiErrorx } from '@commercetools/connect-payments-sdk';
import { initEasyCreditClient } from '../../src/client/easycredit.client';
import { ECTransactionCustomerRelationship } from '../../src/types/payment.types';
import { readConfiguration } from '../../src/utils/config.utils';
import { getCustomObjectByKey } from '../../src/commercetools/customObject.commercetools';

jest.mock('../../src/client/create.client', () => ({
  createApiRoot: jest.fn(),
}));
jest.mock('../../src/commercetools/customObject.commercetools');
jest.mock('../../src/utils/config.utils');
jest.mock('../../src/commercetools/cart.commercetools');
jest.mock('../../src/commercetools/payment.commercetools');
jest.mock('../../src/libs/logger');
jest.mock('../../src/client/easycredit.client');

describe('Payment Handling Functions', () => {
  const cartId = 'cartId123';
  const paymentId = 'paymentId123';
  const cart = {
    billingAddress: {
      firstName: 'John',
      lastName: 'Doe',
      streetName: 'Main St',
      streetNumber: '123',
      postalCode: '12345',
      city: 'Berlin',
      country: 'DE',
    } as Address,
    shippingAddress: {
      firstName: 'John',
      lastName: 'Doe',
      streetName: 'Main St',
      streetNumber: '123',
      postalCode: '12345',
      city: 'Berlin',
      country: 'DE',
    } as Address,
    totalPrice: {
      currencyCode: 'EUR',
      centAmount: 50000,
      fractionDigits: 2,
      type: 'centPrecision',
    },
    cartState: 'Frozen',
    lineItems: [
      {
        name: { de: 'Product 1' },
        quantity: 1,
        price: {
          value: {
            centAmount: 50000,
            fractionDigits: 2,
          },
        },
        variant: {
          sku: '123456',
        },
      },
    ],
  };

  beforeEach(() => {
    (readConfiguration as jest.Mock).mockReturnValue({
      easyCredit: { webShopId: 'webShopId123' },
    });
    (initEasyCreditClient as jest.Mock).mockReturnValue({
      createPayment: jest.fn(),
      authorizePayment: jest.fn(),
    });
  });

  describe('handlePaymentMethod', () => {
    it('should return the webShopId if the cart is valid', async () => {
      (getCartById as jest.Mock).mockResolvedValue(cart);

      const response = await handlePaymentMethod(cartId);

      expect(response).toEqual({ webShopId: 'webShopId123' });
      expect(getCartById).toHaveBeenCalledWith(cartId);
    });

    it('should throw a MultiErrorx if the cart is invalid', async () => {
      const invalidCart = { ...cart, billingAddress: null };
      (getCartById as jest.Mock).mockResolvedValue(invalidCart);

      await expect(handlePaymentMethod(cartId)).rejects.toThrow(MultiErrorx);
    });

    it('should log an error if an exception occurs', async () => {
      const error = new Error('Cart not found');
      (getCartById as jest.Mock).mockRejectedValue(error);

      await expect(handlePaymentMethod(cartId)).rejects.toThrow(error);
      expect(log.error).toHaveBeenCalledWith('Error in getting EasyCredit Payment Method', error);
    });
  });

  describe('handleCreatePayment', () => {
    const redirectLinks = {
      urlDenial: 'https://example.com/webhook/payment123/deny?redirectUrl=https://example.com/success',
      urlCancellation: 'https://example.com/webhook/payment123/cancel?redirectUrl=https://example.com/success',
      urlSuccess: 'https://example.com/success',
    };
    const customerRelationship: ECTransactionCustomerRelationship = {
      customerStatus: 'NEW_CUSTOMER',
      customerSince: '2024-01-01',
      numberOfOrders: 0,
    };
    const ecPayment = {
      transactionId: 'ecTransactionId123',
      transactionInformation: { decision: { decisionOutcome: 'POSITIVE' } },
    };

    it('should create a payment and return the ecPayment response', async () => {
      (getCustomObjectByKey as jest.Mock).mockResolvedValue({ value: 'https://example.com' });
      (getCartById as jest.Mock).mockResolvedValue(cart);
      (createPayment as jest.Mock).mockResolvedValue({ id: 'paymentId123' });
      (initEasyCreditClient().createPayment as jest.Mock).mockResolvedValue(ecPayment);
      (updateCart as jest.Mock).mockResolvedValue(cart);

      const response = await handleCreatePayment(cartId, redirectLinks, customerRelationship);

      expect(response).toEqual(ecPayment);
      expect(getCartById).toHaveBeenCalledWith(cartId);
      expect(createPayment).toHaveBeenCalled();
      expect(initEasyCreditClient().createPayment).toHaveBeenCalled();
    });

    it('should throw a MultiErrorx if cart validation fails', async () => {
      const invalidCart = { ...cart, billingAddress: null };
      (getCartById as jest.Mock).mockResolvedValue(invalidCart);

      await expect(handleCreatePayment(cartId, redirectLinks, customerRelationship)).rejects.toThrow(MultiErrorx);
    });

    it('should log an error if an exception occurs', async () => {
      const error = new Error('Error creating payment');
      (getCartById as jest.Mock).mockResolvedValue(cart);
      (createPayment as jest.Mock).mockRejectedValue(error);

      await expect(handleCreatePayment(cartId, redirectLinks, customerRelationship)).rejects.toThrow(error);
      expect(log.error).toHaveBeenCalledWith('Error in handleCreatePayment', error);
    });
  });

  describe('handleAuthorizePayment', () => {
    it('should authorize the payment and update the transaction state', async () => {
      const payment = {
        id: paymentId,
        paymentMethodInfo: {
          paymentInterface: 'easycredit',
        },
        transactions: [
          {
            type: 'Authorization',
            state: 'Pending',
            interactionId: 'interactionId123',
            amount: {
              currencyCode: 'EUR',
              centAmount: 50000,
              fractionDigits: 2,
            },
          },
        ],
      };
      const transaction = { interactionId: 'interactionId123' };

      (getPaymentById as jest.Mock).mockResolvedValue(payment);
      (initEasyCreditClient().authorizePayment as jest.Mock).mockResolvedValue({});
      (updatePayment as jest.Mock).mockResolvedValue({});
      // Mock getPendingTransaction to return the mocked transaction

      await handleAuthorizePayment(paymentId);

      expect(getPaymentById).toHaveBeenCalledWith(paymentId);
      expect(initEasyCreditClient().authorizePayment).toHaveBeenCalledWith(transaction.interactionId);
      expect(updatePayment).toHaveBeenCalled();
    });

    it('should log an error if an exception occurs', async () => {
      const error = new Error('Error authorizing payment');
      (getPaymentById as jest.Mock).mockRejectedValue(error);

      await expect(handleAuthorizePayment(paymentId)).rejects.toThrow(error);
      expect(log.error).toHaveBeenCalledWith('Error in authorizing EasyCredit Payment', error);
    });
  });
});
