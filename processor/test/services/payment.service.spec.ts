import {
  handlePaymentMethod,
  handleCreatePayment,
  handleAuthorizeECPayment,
  handleCancelPayment,
  handleAuthorizePayment,
  handleGetPayment,
  handleCapturePayment,
} from '../../src/services/payment.service';
import { getCartById, updateCart, getCartByPaymentId } from '../../src/commercetools/cart.commercetools';
import { getPaymentById, createPayment, updatePayment } from '../../src/commercetools/payment.commercetools';
import { initEasyCreditClient } from '../../src/client/easycredit.client';
import { log } from '../../src/libs/logger';
import {
  validatePayment,
  validatePendingTransaction,
  validateAddresses,
  validateCurrency,
  validateCartAmount,
  validateTransaction,
  validateInitialOrPendingTransaction,
  validateSuccessTransaction,
} from '../../src/validators/payment.validators';
import { readConfiguration } from '../../src/utils/config.utils';
import { getPendingTransaction, getSuccessTransaction, getTransaction } from '../../src/utils/payment.utils';
import { Errorx, MultiErrorx } from '@commercetools/connect-payments-sdk';
import { CTTransactionState, CTTransactionType, ECTransactionStatus } from '../../src/types/payment.types';
import { mapCreatePaymentResponse } from '../../src/utils/map.utils';
import { describe, jest, it, expect, beforeEach } from '@jest/globals';

jest.mock('../../src/commercetools/cart.commercetools');
jest.mock('../../src/commercetools/payment.commercetools');
jest.mock('../../src/client/easycredit.client');
jest.mock('../../src/libs/logger');
jest.mock('../../src/validators/payment.validators', () => ({
  validateAddresses: jest.fn(),
  validateCurrency: jest.fn(),
  validateCartAmount: jest.fn(),
  validatePayment: jest.fn(),
  validatePendingTransaction: jest.fn(),
  validateSuccessTransaction: jest.fn(),
  validateTransaction: jest.fn(),
  validateInitialOrPendingTransaction: jest.fn(),
}));
jest.mock('../../src/utils/map.utils');
jest.mock('../../src/utils/config.utils', () => ({
  readConfiguration: jest.fn().mockReturnValue({
    easyCredit: { webShopId: 'webShopId123' },
    commerceTools: {
      projectKey: 'projectKey123',
      clientId: 'clientId123',
      clientSecret: 'clientSecret',
      region: 'eu',
    },
  }),
}));
jest.mock('../../src/utils/payment.utils');

describe('Payment handlers', () => {
  describe('handlePaymentMethod', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return the payment method when validation passes', async () => {
      const mockCart = {
        billingAddress: {},
        shippingAddress: {},
        totalPrice: { currencyCode: 'EUR', centAmount: 1000, fractionDigits: 2 },
      };
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue(mockCart);
      (validateAddresses as jest.Mock).mockReturnValue([]);
      (validateCurrency as jest.Mock).mockReturnValue([]);
      (validateCartAmount as jest.Mock).mockReturnValue([]);

      const result = await handlePaymentMethod('cart123');

      expect(result).toEqual({ webShopId: 'webShopId123', amount: 10 });
      expect(getCartById).toHaveBeenCalledWith('cart123');
    });

    it('should throw a MultiErrorx if cart validation fails', async () => {
      const mockCart = {
        billingAddress: {},
        shippingAddress: {},
        totalPrice: { currencyCode: 'EUR', centAmount: 1000 },
      };
      const mockError = new Errorx({ httpErrorStatus: 0, code: 'InvalidCart', message: 'Invalid cart' });
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue(mockCart);
      (validateAddresses as jest.Mock).mockImplementationOnce((billingAddress, shippingAddress, ecConfig, errors) => {
        // @ts-expect-error mocked
        errors.push(mockError);
      });

      await expect(handlePaymentMethod('cart123')).rejects.toThrow(MultiErrorx);
      expect(log.error).toHaveBeenCalledWith('Error in getting EasyCredit Payment Method', expect.any(Error));
    });

    it('should log and rethrow any unknown error', async () => {
      const error = new Error('Unexpected error');
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockRejectedValue(error);

      await expect(handlePaymentMethod('cart123')).rejects.toThrow(error);
      expect(log.error).toHaveBeenCalledWith('Error in getting EasyCredit Payment Method', error);
    });
  });

  describe('handleGetPayment', () => {
    const mockPaymentId = 'payment123';
    const mockTransaction = { interactionId: 'interaction123', amount: { centAmount: 1000, fractionDigits: 2 } };
    const mockPayment = { id: 'payment123', transactions: [mockTransaction] };
    const mockECResponse = { status: 'success', amount: 10, webShopId: 'webShopId123' };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should get the payment and return the EasyCredit payment response', async () => {
      // Mocking the utility functions
      // @ts-expect-error mocked
      (getPaymentById as jest.Mock).mockResolvedValue(mockPayment);
      (validatePayment as jest.Mock).mockReturnValue(true);
      (validateTransaction as jest.Mock).mockReturnValue(true);
      (getTransaction as jest.Mock).mockReturnValue(mockTransaction);

      // Mocking the EasyCredit client
      // @ts-expect-error mocked
      const mockEasyCreditClient = { getPayment: jest.fn().mockResolvedValue(mockECResponse) };
      (initEasyCreditClient as jest.Mock).mockReturnValue(mockEasyCreditClient);

      // Call the function
      const result = await handleGetPayment(mockPaymentId);

      // Assertions
      expect(getPaymentById).toHaveBeenCalledWith(mockPaymentId);
      expect(validatePayment).toHaveBeenCalledWith(mockPayment);
      expect(validateTransaction).toHaveBeenCalledWith(mockPayment);
      expect(getTransaction).toHaveBeenCalledWith(mockPayment);
      expect(mockEasyCreditClient.getPayment).toHaveBeenCalledWith(mockTransaction.interactionId);

      // Check the result
      expect(result).toEqual(mockECResponse);
    });

    it('should log error and throw if an error occurs', async () => {
      const errorMessage = 'Test error';
      // @ts-expect-error mocked
      (getPaymentById as jest.Mock).mockRejectedValue(new Error(errorMessage));

      await expect(handleGetPayment(mockPaymentId)).rejects.toThrow(errorMessage);

      expect(log.error).toHaveBeenCalledWith('Error in getting summary Payment', expect.any(Error));
    });
  });

  describe('handleCreatePayment', () => {
    it('should successfully create a payment and freeze the cart', async () => {
      const mockCart = { cartState: 'Active', totalPrice: { currencyCode: 'EUR', centAmount: 1000 } };
      const mockPayment = { id: 'payment123' };
      const mockECPayment = {
        transactionInformation: { decision: { decisionOutcome: 'POSITIVE' } },
        paymentId: 'ecTransaction123',
      };
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue(mockCart);
      // @ts-expect-error mocked
      (createPayment as jest.Mock).mockResolvedValue(mockPayment);
      // @ts-expect-error mocked
      (updateCart as jest.Mock).mockResolvedValue(mockCart);
      (initEasyCreditClient as jest.Mock).mockReturnValue({
        // @ts-expect-error mocked
        createPayment: jest.fn().mockResolvedValue(mockECPayment),
      });
      (readConfiguration as jest.Mock).mockReturnValue({ easyCredit: { webShopId: 'webShopId123' } });
      (mapCreatePaymentResponse as jest.Mock).mockReturnValue(mockECPayment);

      const result = await handleCreatePayment(
        'cart123',
        {
          urlSuccess: 'https://example.com/success',
          urlCancellation: 'https://example.com/cancel',
          urlDenial: 'https://example.com/cancel',
        },
        {
          customerStatus: 'NEW_CUSTOMER',
          customerSince: '2024-01-01',
          numberOfOrders: 0,
        },
      );

      expect(result).toEqual(mockECPayment);
      expect(updateCart).toHaveBeenCalledWith(mockCart, [{ action: 'freezeCart' }]);
      expect(createPayment).toHaveBeenCalled();
    });

    it('should handle failure of decisionOutcome and unfreeze the cart', async () => {
      const mockCart = { cartState: 'Active', totalPrice: { currencyCode: 'EUR', centAmount: 1000 } };
      const mockPayment = { id: 'payment123' };
      const mockECPayment = {
        transactionInformation: { decision: { decisionOutcome: 'NEGATIVE', decisionOutcomeText: 'NEGATIVE' } },
        transactionId: 'ecTransaction123',
      };
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue(mockCart);
      // @ts-expect-error mocked
      (createPayment as jest.Mock).mockResolvedValue(mockPayment);
      // @ts-expect-error mocked
      (updateCart as jest.Mock).mockResolvedValue(mockCart);
      (initEasyCreditClient as jest.Mock).mockReturnValue({
        // @ts-expect-error mocked
        createPayment: jest.fn().mockResolvedValue(mockECPayment),
      });

      await expect(
        handleCreatePayment(
          'cart123',
          {
            urlSuccess: 'https://example.com/success',
            urlCancellation: 'https://example.com/cancel',
            urlDenial: 'https://example.com/cancel',
          },
          {
            customerStatus: 'NEW_CUSTOMER',
            customerSince: '2024-01-01',
            numberOfOrders: 0,
          },
        ),
      ).rejects.toThrow(
        new MultiErrorx([
          new Errorx({
            code: 'TransactionNotSuccess',
            message: 'NEGATIVE',
            httpErrorStatus: 400,
          }),
        ]),
      );
      expect(updateCart).toHaveBeenCalledWith(mockCart, [{ action: 'unfreezeCart' }]);
    });

    it('should unfreeze the cart if payment creation fails', async () => {
      const mockCart = { cartState: 'Active', totalPrice: { currencyCode: 'EUR', centAmount: 1000 } };
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue(mockCart);
      // @ts-expect-error mocked
      (updateCart as jest.Mock).mockResolvedValue(mockCart);
      // @ts-expect-error mocked
      (createPayment as jest.Mock).mockRejectedValue(new Error('Payment creation failed'));

      await expect(
        handleCreatePayment(
          'cart123',
          {
            urlSuccess: 'https://example.com/success',
            urlCancellation: 'https://example.com/cancel',
            urlDenial: 'https://example.com/cancel',
          },
          {
            customerStatus: 'NEW_CUSTOMER',
            customerSince: '2024-01-01',
            numberOfOrders: 0,
          },
        ),
      ).rejects.toThrow('Payment creation failed');
      expect(updateCart).toHaveBeenCalledWith(mockCart, [{ action: 'unfreezeCart' }]);
    });

    it('should log and rethrow errors', async () => {
      const error = new Error('Some unexpected error');
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockRejectedValue(error);

      await expect(
        handleCreatePayment(
          'cart123',
          {
            urlSuccess: 'https://example.com/success',
            urlCancellation: 'https://example.com/cancel',
            urlDenial: 'https://example.com/cancel',
          },
          {
            customerStatus: 'NEW_CUSTOMER',
            customerSince: '2024-01-01',
            numberOfOrders: 0,
          },
        ),
      ).rejects.toThrow(error);
      expect(log.error).toHaveBeenCalledWith('Error in handleCreatePayment', error);
    });
  });

  describe('handleAuthorizeECPayment', () => {
    it('should successfully authorize a payment', async () => {
      const mockPayment = {
        id: 'payment123',
        transactions: [{ id: 'transaction123', interactionId: 'interactionId123' }],
      };
      const mockECTransaction = {
        status: ECTransactionStatus.PREAUTHORIZED,
        transaction: {
          orderDetails: {
            orderId: '12345',
          },
        },
      };
      // @ts-expect-error mocked
      (getPaymentById as jest.Mock).mockResolvedValue(mockPayment);
      (initEasyCreditClient as jest.Mock).mockReturnValue({
        // @ts-expect-error mocked
        authorizePayment: jest.fn().mockResolvedValue({}),
        // @ts-expect-error mocked
        getPayment: jest.fn().mockResolvedValue(mockECTransaction),
      });
      (validatePayment as jest.Mock).mockReturnValue(true);
      (validateTransaction as jest.Mock).mockReturnValue(true);
      (getTransaction as jest.Mock).mockReturnValue(mockPayment.transactions[0]);

      await handleAuthorizeECPayment('payment123');

      expect(initEasyCreditClient().authorizePayment).toHaveBeenCalledWith('interactionId123', 'payment123');
      expect(initEasyCreditClient().getPayment).toHaveBeenCalledWith('interactionId123');
    });

    it('should throw and log error if payment authorization fails', async () => {
      const mockError = new Error('Authorization failed');
      // @ts-expect-error mocked
      (getPaymentById as jest.Mock).mockRejectedValue(mockError);

      await expect(handleAuthorizeECPayment('payment123')).rejects.toThrow('Authorization failed');
      expect(log.error).toHaveBeenCalledWith('Error in authorizing EasyCredit Payment', mockError);
    });
  });

  describe('handleAuthorizePayment', () => {
    it('should successfully authorize a payment', async () => {
      const mockPayment = {
        id: 'payment123',
        transactions: [{ id: 'transaction123', interactionId: 'interactionId123' }],
      };
      // @ts-expect-error mocked
      (getPaymentById as jest.Mock).mockResolvedValue(mockPayment);
      (initEasyCreditClient as jest.Mock).mockReturnValue({
        // @ts-expect-error mocked
        getPayment: jest.fn().mockResolvedValue({
          status: ECTransactionStatus.AUTHORIZED,
        }),
      });
      (validatePayment as jest.Mock).mockReturnValue(true);
      (validatePendingTransaction as jest.Mock).mockReturnValue(true);
      (getPendingTransaction as jest.Mock).mockReturnValue(mockPayment.transactions[0]);

      await handleAuthorizePayment('payment123');

      expect(initEasyCreditClient().getPayment).toHaveBeenCalledWith('interactionId123');
      expect(updatePayment).toHaveBeenCalledWith(mockPayment, [
        { action: 'changeTransactionState', transactionId: 'interactionId123', state: 'Success' },
      ]);
    });

    it('should throw error on not success payment', async () => {
      const mockPayment = {
        id: 'payment123',
        transactions: [{ id: 'transaction123', interactionId: 'interactionId123' }],
      };
      // @ts-expect-error mocked
      (getPaymentById as jest.Mock).mockResolvedValue(mockPayment);
      (initEasyCreditClient as jest.Mock).mockReturnValue({
        // @ts-expect-error mocked
        getPayment: jest.fn().mockResolvedValue({
          status: ECTransactionStatus.DECLINED,
        }),
      });
      (validatePayment as jest.Mock).mockReturnValue(true);
      (validatePendingTransaction as jest.Mock).mockReturnValue(true);
      (getPendingTransaction as jest.Mock).mockReturnValue(mockPayment.transactions[0]);

      await expect(handleAuthorizePayment('payment123')).rejects.toThrow(
        'You are not allow to authorize a payment without EasyCredit Authorized transaction.',
      );
      expect(log.error).toHaveBeenCalledWith(
        'Error in authorizing CT Payment',
        new Errorx({
          code: 'TransactionNotSuccess',
          message: 'You are not allow to authorize a payment without EasyCredit Authorized transaction.',
          httpErrorStatus: 400,
        }),
      );
      expect(initEasyCreditClient().getPayment).toHaveBeenCalledWith('interactionId123');
    });

    it('should throw and log error if payment authorization fails', async () => {
      const mockError = new Error('Authorization failed');
      // @ts-expect-error mocked
      (getPaymentById as jest.Mock).mockRejectedValue(mockError);

      await expect(handleAuthorizePayment('payment123')).rejects.toThrow('Authorization failed');
      expect(log.error).toHaveBeenCalledWith('Error in authorizing CT Payment', mockError);
    });
  });

  describe('handleCancelPayment', () => {
    it('should successfully cancel the payment and unfreeze the cart', async () => {
      const mockPayment = {
        id: 'payment123',
        transactions: [
          {
            id: 'transaction123',
            interactionId: 'interactionId123',
            type: CTTransactionType.Authorization,
            state: CTTransactionState.Initial,
          },
        ],
      };
      const mockCart = { id: 'cart123' };
      const mockEasyTransaction = { status: ECTransactionStatus.OPEN };
      // @ts-expect-error mocked
      (getPaymentById as jest.Mock).mockResolvedValue(mockPayment);
      (validateInitialOrPendingTransaction as jest.Mock).mockReturnValue(mockPayment.transactions[0]);
      (initEasyCreditClient as jest.Mock).mockReturnValue({
        // @ts-expect-error mocked
        getPayment: jest.fn().mockResolvedValue(mockEasyTransaction),
      });
      // @ts-expect-error mocked
      (getCartByPaymentId as jest.Mock).mockResolvedValue(mockCart);

      const result = await handleCancelPayment('payment123');

      expect(result).toEqual('payment123');
      expect(updatePayment).toHaveBeenCalledWith(mockPayment, [
        { action: 'changeTransactionState', transactionId: 'interactionId123', state: 'Failure' },
      ]);
      expect(updateCart).toHaveBeenCalledWith(mockCart, [{ action: 'unfreezeCart' }]);
    });

    it('should throw an error if the transaction is authorized', async () => {
      const mockPayment = {
        id: 'payment123',
        transactions: [{ id: 'transaction123', interactionId: 'interactionId123' }],
      };
      const mockEasyTransaction = { status: ECTransactionStatus.AUTHORIZED };
      // @ts-expect-error mocked
      (getPaymentById as jest.Mock).mockResolvedValue(mockPayment);
      (initEasyCreditClient as jest.Mock).mockReturnValue({
        // @ts-expect-error mocked
        getPayment: jest.fn().mockResolvedValue(mockEasyTransaction),
      });

      await expect(handleCancelPayment('payment123')).rejects.toThrow(Errorx);
      await expect(handleCancelPayment('payment123')).rejects.toThrow(
        'You are not allow to cancel a payment with Easy Credit AUTHORIZED transaction.',
      );
    });

    it('should log and rethrow errors during cancellation', async () => {
      const mockError = new Error('Cancel error');
      // @ts-expect-error mocked
      (getPaymentById as jest.Mock).mockRejectedValue(mockError);

      await expect(handleCancelPayment('payment123')).rejects.toThrow('Cancel error');
      expect(log.error).toHaveBeenCalledWith('Error in cancelling payment and unfreezing cart', mockError);
    });
  });

  describe('handleCaptureECPayment', () => {
    it('should successfully capture a payment', async () => {
      const mockPayment = {
        id: 'payment123',
        transactions: [{ id: 'transaction123', interactionId: 'interactionId123' }],
      };
      const mockECTransaction = {
        status: ECTransactionStatus.AUTHORIZED,
        transaction: {
          orderDetails: {
            orderId: '12345',
          },
        },
        decision: {
          transactionId: 'transactionId123',
        },
      };
      // @ts-expect-error mocked
      (getPaymentById as jest.Mock).mockResolvedValue(mockPayment);
      (initEasyCreditClient as jest.Mock).mockReturnValue({
        // @ts-expect-error mocked
        capturePayment: jest.fn().mockResolvedValue(true),
        // @ts-expect-error mocked
        getPayment: jest.fn().mockResolvedValue(mockECTransaction),
      });
      (validatePayment as jest.Mock).mockReturnValue(true);
      (validateSuccessTransaction as jest.Mock).mockReturnValue(true);
      (getSuccessTransaction as jest.Mock).mockReturnValue(mockPayment.transactions[0]);

      await handleCapturePayment('payment123', 'orderId', 'trackingNumber');

      expect(initEasyCreditClient().capturePayment).toHaveBeenCalledWith(
        'transactionId123',
        'orderId',
        'trackingNumber',
      );
      expect(initEasyCreditClient().getPayment).toHaveBeenCalledWith('interactionId123');
    });

    it('should throw and log error if payment capture fails', async () => {
      const mockError = new Error('Capture failed');
      // @ts-expect-error mocked
      (getPaymentById as jest.Mock).mockRejectedValue(mockError);

      await expect(handleCapturePayment('payment123')).rejects.toThrow('Capture failed');
      expect(log.error).toHaveBeenCalledWith('Error in capturing payment', mockError);
    });
  });
});
