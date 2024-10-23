import {
  handlePaymentMethod,
  handleCreatePayment,
  handleAuthorizePayment,
  handleCancelPayment,
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
} from '../../src/validators/payment.validators';
import { readConfiguration } from '../../src/utils/config.utils';
import { getPendingTransaction } from '../../src/utils/payment.utils';
import { Errorx, MultiErrorx } from '@commercetools/connect-payments-sdk';
import { ECTransactionStatus } from '../../src/types/payment.types';

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
      (getCartById as jest.Mock).mockResolvedValue(mockCart);
      (validateAddresses as jest.Mock).mockImplementationOnce((billingAddress, shippingAddress, ecConfig, errors) => {
        errors.push(mockError);
      });

      await expect(handlePaymentMethod('cart123')).rejects.toThrow(MultiErrorx);
      expect(log.error).toHaveBeenCalledWith('Error in getting EasyCredit Payment Method', expect.any(Error));
    });

    it('should log and rethrow any unknown error', async () => {
      const error = new Error('Unexpected error');
      (getCartById as jest.Mock).mockRejectedValue(error);

      await expect(handlePaymentMethod('cart123')).rejects.toThrow(error);
      expect(log.error).toHaveBeenCalledWith('Error in getting EasyCredit Payment Method', error);
    });
  });

  describe('handleCreatePayment', () => {
    it('should successfully create a payment and freeze the cart', async () => {
      const mockCart = { cartState: 'Active', totalPrice: { currencyCode: 'EUR', centAmount: 1000 } };
      const mockPayment = { id: 'payment123' };
      const mockECPayment = {
        transactionInformation: { decision: { decisionOutcome: 'POSITIVE' } },
        transactionId: 'ecTransaction123',
      };
      (getCartById as jest.Mock).mockResolvedValue(mockCart);
      (createPayment as jest.Mock).mockResolvedValue(mockPayment);
      (updateCart as jest.Mock).mockResolvedValue(mockCart);
      (initEasyCreditClient as jest.Mock).mockReturnValue({
        createPayment: jest.fn().mockResolvedValue(mockECPayment),
      });
      (readConfiguration as jest.Mock).mockReturnValue({ easyCredit: { webShopId: 'webShopId123' } });

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
        transactionInformation: { decision: { decisionOutcome: 'NEGATIVE' } },
        transactionId: 'ecTransaction123',
      };
      (getCartById as jest.Mock).mockResolvedValue(mockCart);
      (createPayment as jest.Mock).mockResolvedValue(mockPayment);
      (updateCart as jest.Mock).mockResolvedValue(mockCart);
      (initEasyCreditClient as jest.Mock).mockReturnValue({
        createPayment: jest.fn().mockResolvedValue(mockECPayment),
      });

      const data = await handleCreatePayment(
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
      await expect(data).toBe(mockECPayment);
      expect(updateCart).toHaveBeenCalledWith(mockCart, [{ action: 'unfreezeCart' }]);
    });

    it('should unfreeze the cart if payment creation fails', async () => {
      const mockCart = { cartState: 'Active', totalPrice: { currencyCode: 'EUR', centAmount: 1000 } };
      (getCartById as jest.Mock).mockResolvedValue(mockCart);
      (updateCart as jest.Mock).mockResolvedValue(mockCart);
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

  describe('handleAuthorizePayment', () => {
    it('should successfully authorize a payment', async () => {
      const mockPayment = {
        id: 'payment123',
        transactions: [{ id: 'transaction123', interactionId: 'interactionId123' }],
      };
      (getPaymentById as jest.Mock).mockResolvedValue(mockPayment);
      (initEasyCreditClient as jest.Mock).mockReturnValue({ authorizePayment: jest.fn().mockResolvedValue({}) });
      (validatePayment as jest.Mock).mockReturnValue(true);
      (validatePendingTransaction as jest.Mock).mockReturnValue(true);
      (getPendingTransaction as jest.Mock).mockReturnValue(mockPayment.transactions[0]);

      await handleAuthorizePayment('payment123');

      expect(initEasyCreditClient().authorizePayment).toHaveBeenCalledWith('interactionId123');
      expect(updatePayment).toHaveBeenCalledWith(mockPayment, [
        { action: 'changeTransactionState', transactionId: 'interactionId123', state: 'Success' },
      ]);
    });

    it('should throw and log error if payment authorization fails', async () => {
      const mockError = new Error('Authorization failed');
      (getPaymentById as jest.Mock).mockRejectedValue(mockError);

      await expect(handleAuthorizePayment('payment123')).rejects.toThrow('Authorization failed');
      expect(log.error).toHaveBeenCalledWith('Error in authorizing EasyCredit Payment', mockError);
    });
  });

  describe('handleCancelPayment', () => {
    it('should successfully cancel the payment and unfreeze the cart', async () => {
      const mockPayment = {
        id: 'payment123',
        transactions: [{ id: 'transaction123', interactionId: 'interactionId123' }],
      };
      const mockCart = { id: 'cart123' };
      const mockEasyTransaction = { status: ECTransactionStatus.FAILURE };
      (getPaymentById as jest.Mock).mockResolvedValue(mockPayment);
      (getPendingTransaction as jest.Mock).mockReturnValue(mockPayment.transactions[0]);
      (initEasyCreditClient as jest.Mock).mockReturnValue({
        getPayment: jest.fn().mockResolvedValue(mockEasyTransaction),
      });
      (getCartByPaymentId as jest.Mock).mockResolvedValue(mockCart);

      const result = await handleCancelPayment('payment123');

      expect(result).toEqual('payment123');
      expect(updatePayment).toHaveBeenCalledWith(mockPayment, [
        { action: 'changeTransactionState', transactionId: 'interactionId123', state: 'Failure' },
      ]);
      expect(updateCart).toHaveBeenCalledWith(mockCart, [{ action: 'unfreezeCart' }]);
    });

    it('should throw an error if the transaction is not declined', async () => {
      const mockPayment = {
        id: 'payment123',
        transactions: [{ id: 'transaction123', interactionId: 'interactionId123' }],
      };
      const mockEasyTransaction = { status: 'Success' };
      (getPaymentById as jest.Mock).mockResolvedValue(mockPayment);
      (initEasyCreditClient as jest.Mock).mockReturnValue({
        getPayment: jest.fn().mockResolvedValue(mockEasyTransaction),
      });

      await expect(handleCancelPayment('payment123')).rejects.toThrow(Errorx);
      await expect(handleCancelPayment('payment123')).rejects.toThrow('Transaction status is not DECLINED');
    });

    it('should log and rethrow errors during cancellation', async () => {
      const mockError = new Error('Cancel error');
      (getPaymentById as jest.Mock).mockRejectedValue(mockError);

      await expect(handleCancelPayment('payment123')).rejects.toThrow('Cancel error');
      expect(log.error).toHaveBeenCalledWith('Error in cancelling payment and unfreezing cart', mockError);
    });
  });
});
