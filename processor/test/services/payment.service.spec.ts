import {
  handleAuthorizeECPayment,
  handleAuthorizePayment,
  handleCancelPayment,
  handleCapturePayment,
  handleCreatePayment,
  handleGetPayment,
  handlePaymentMethod,
  handleRefundPayment,
} from '../../src/services/payment.service';
import { getCartById, getCartByPaymentId, updateCart } from '../../src/commercetools/cart.commercetools';
import { createPayment, getPaymentById, updatePayment } from '../../src/commercetools/payment.commercetools';
import { initEasyCreditClient } from '../../src/client/easycredit.client';
import { log } from '../../src/libs/logger';
import {
  validateAddresses,
  validateCartAmount,
  validateCurrency,
  validateInitialOrPendingTransaction,
  validateInitialRefundTransaction,
  validatePayment,
  validatePaymentAmount,
  validatePendingTransaction,
  validateSuccessTransaction,
  validateTransaction,
} from '../../src/validators/payment.validators';
import { readConfiguration } from '../../src/utils/config.utils';
import { getPendingTransaction, getSuccessTransaction, getTransaction } from '../../src/utils/payment.utils';
import { Errorx, MultiErrorx } from '@commercetools/connect-payments-sdk';
import { CTTransactionState, CTTransactionType, ECTransactionStatus } from '../../src/types/payment.types';
import { mapCreatePaymentResponse } from '../../src/utils/map.utils';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('../../src/commercetools/cart.commercetools');
jest.mock('../../src/commercetools/payment.commercetools');
jest.mock('../../src/client/easycredit.client');
jest.mock('../../src/libs/logger');
jest.mock('../../src/validators/payment.validators', () => ({
  isEasyCreditPayment: jest.requireActual<typeof import('../../src/validators/payment.validators')>(
    '../../src/validators/payment.validators',
  ).isEasyCreditPayment,
  validateAddresses: jest.fn(),
  validateCurrency: jest.fn(),
  validateCartAmount: jest.fn(),
  validatePayment: jest.fn(),
  validatePendingTransaction: jest.fn(),
  validateSuccessTransaction: jest.fn(),
  validateTransaction: jest.fn(),
  validateInitialOrPendingTransaction: jest.fn(),
  validatePaymentAmount: jest.fn(),
  validateInitialRefundTransaction: jest.fn(),
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
const { getTransaction: actualGetTransaction } = jest.requireActual<typeof import('../../src/utils/payment.utils')>(
  '../../src/utils/payment.utils',
);

describe('Payment handlers', () => {
  // --clearMocks keeps implementations; reset this one so tests that use the real getTransaction don't leak.
  afterEach(() => {
    (getTransaction as jest.Mock).mockReset();
  });

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
    const mockTransaction = {
      interactionId: 'interactionId',
      amount: { centAmount: 1000, fractionDigits: 2 },
      custom: { fields: { easyCreditTechnicalTransactionId: 'easyCreditTechnicalTransactionId' } },
    };
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
      expect(mockEasyCreditClient.getPayment).toHaveBeenCalledWith(
        mockTransaction.custom.fields.easyCreditTechnicalTransactionId,
      );

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

    it('should fail older Initial easyCredit payments on the cart and leave other connectors alone', async () => {
      (getTransaction as jest.Mock).mockImplementation(actualGetTransaction as never);
      const abandoned = {
        id: 'old',
        paymentMethodInfo: { paymentInterface: 'easycredit' },
        transactions: [{ id: 'txOld', type: CTTransactionType.Authorization, state: CTTransactionState.Initial }],
      };
      const foreign = {
        id: 'foreign',
        paymentMethodInfo: { paymentInterface: 'other-psp' },
        transactions: [{ id: 'txForeign', type: CTTransactionType.Authorization, state: CTTransactionState.Initial }],
      };
      const mockCart = {
        cartState: 'Frozen',
        totalPrice: { currencyCode: 'EUR', centAmount: 1000 },
        paymentInfo: { payments: [{ id: 'old' }, { id: 'foreign' }] },
      };
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue(mockCart);
      (getPaymentById as jest.Mock).mockImplementation(async (id) => (id === 'old' ? abandoned : foreign));
      // @ts-expect-error mocked
      (createPayment as jest.Mock).mockResolvedValue({ id: 'new' });
      // @ts-expect-error mocked
      (updateCart as jest.Mock).mockResolvedValue(mockCart);
      (initEasyCreditClient as jest.Mock).mockReturnValue({
        createPayment: jest
          .fn()
          // @ts-expect-error mocked
          .mockResolvedValue({ transactionInformation: { decision: { decisionOutcome: 'POSITIVE' } } }),
      });

      await handleCreatePayment(
        'cart123',
        {
          urlSuccess: 'https://example.com/success',
          urlCancellation: 'https://example.com/cancel',
          urlDenial: 'https://example.com/cancel',
        },
        { customerStatus: 'NEW_CUSTOMER', customerSince: '2024-01-01', numberOfOrders: 0 },
      );

      expect(updatePayment).toHaveBeenCalledWith(abandoned, [
        { action: 'changeTransactionState', transactionId: 'txOld', state: 'Failure' },
      ]);
      expect(updatePayment).not.toHaveBeenCalledWith(foreign, expect.anything());
    });

    it('should handle failure of decisionOutcome and unfreeze the cart', async () => {
      const mockCart = { cartState: 'Frozen', totalPrice: { currencyCode: 'EUR', centAmount: 1000 } };
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
      const frozenCart = { ...mockCart, cartState: 'Frozen' };
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue(mockCart);
      // @ts-expect-error mocked
      (updateCart as jest.Mock).mockResolvedValue(frozenCart);
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
      expect(updateCart).toHaveBeenCalledWith(frozenCart, [{ action: 'unfreezeCart' }]);
    });

    it('should keep the cart frozen on failure while an older easyCredit payment is Pending', async () => {
      const pendingPayment = {
        id: 'older',
        paymentMethodInfo: { paymentInterface: 'easycredit' },
        transactions: [{ id: 'txOld', type: CTTransactionType.Authorization, state: CTTransactionState.Pending }],
      };
      const frozenCart = {
        cartState: 'Frozen',
        totalPrice: { currencyCode: 'EUR', centAmount: 1000 },
        paymentInfo: { payments: [{ id: 'older' }] },
      };
      (getTransaction as jest.Mock).mockImplementation(actualGetTransaction as never);
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue(frozenCart);
      // @ts-expect-error mocked
      (getPaymentById as jest.Mock).mockResolvedValue(pendingPayment);
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
          { customerStatus: 'NEW_CUSTOMER', customerSince: '2024-01-01', numberOfOrders: 0 },
        ),
      ).rejects.toThrow('Payment creation failed');
      expect(updateCart).not.toHaveBeenCalled();
      expect(updatePayment).not.toHaveBeenCalled();
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
    it('should refuse to authorize a cancelled payment without calling easyCredit', async () => {
      const cancelled = {
        id: 'payment123',
        transactions: [{ id: 'tx', type: CTTransactionType.Authorization, state: CTTransactionState.Failure }],
      };
      const ecClient = { getPayment: jest.fn(), authorizePayment: jest.fn() };
      // @ts-expect-error mocked
      (getPaymentById as jest.Mock).mockResolvedValue(cancelled);
      (getTransaction as jest.Mock).mockReturnValueOnce(cancelled.transactions[0]);
      (initEasyCreditClient as jest.Mock).mockReturnValue(ecClient);

      await expect(handleAuthorizeECPayment('payment123')).rejects.toThrow(
        'You are not allow to authorize a cancelled payment.',
      );
      expect(ecClient.getPayment).not.toHaveBeenCalled();
      expect(ecClient.authorizePayment).not.toHaveBeenCalled();
      expect(updatePayment).not.toHaveBeenCalled();
    });

    it('should successfully authorize a payment', async () => {
      const mockPayment = {
        id: 'payment123',
        transactions: [
          {
            id: 'transactionId',
            interactionId: 'interactionId123',
            custom: { fields: { easyCreditTechnicalTransactionId: 'easyCreditTechnicalTransactionId' } },
          },
        ],
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

      expect(initEasyCreditClient().authorizePayment).toHaveBeenCalledWith(
        'easyCreditTechnicalTransactionId',
        'payment123',
      );
      expect(initEasyCreditClient().getPayment).toHaveBeenCalledWith('easyCreditTechnicalTransactionId');
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
    it('should do nothing on a repeated callback for an already authorized payment', async () => {
      const ecClient = { getPayment: jest.fn() };
      // @ts-expect-error mocked
      (getPaymentById as jest.Mock).mockResolvedValue({ id: 'payment123', transactions: [] });
      (getSuccessTransaction as jest.Mock).mockReturnValueOnce({ id: 'tx', state: CTTransactionState.Success });
      (initEasyCreditClient as jest.Mock).mockReturnValue(ecClient);

      await expect(handleAuthorizePayment('payment123')).resolves.toBeUndefined();
      expect(validatePendingTransaction).not.toHaveBeenCalled();
      expect(ecClient.getPayment).not.toHaveBeenCalled();
      expect(updatePayment).not.toHaveBeenCalled();
    });

    it('should successfully authorize a payment', async () => {
      const mockPayment = {
        id: 'payment123',
        transactions: [
          {
            id: 'transactionId',
            interactionId: 'interactionId123',
            custom: { fields: { easyCreditTechnicalTransactionId: 'easyCreditTechnicalTransactionId' } },
          },
        ],
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

      expect(initEasyCreditClient().getPayment).toHaveBeenCalledWith('easyCreditTechnicalTransactionId');
      expect(updatePayment).toHaveBeenCalledWith(mockPayment, [
        { action: 'changeTransactionState', transactionId: 'transactionId', state: 'Success' },
      ]);
    });

    it('should throw error on not success payment', async () => {
      const mockPayment = {
        id: 'payment123',
        transactions: [
          {
            id: 'transactionId',
            interactionId: 'interactionId123',
            custom: { fields: { easyCreditTechnicalTransactionId: 'easyCreditTechnicalTransactionId' } },
          },
        ],
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
      expect(initEasyCreditClient().getPayment).toHaveBeenCalledWith('easyCreditTechnicalTransactionId');
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
    beforeEach(() => {
      (getTransaction as jest.Mock).mockImplementation(actualGetTransaction as never);
    });

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
      const mockCart = { id: 'cart123', cartState: 'Frozen', paymentInfo: { payments: [{ id: 'payment123' }] } };
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
        { action: 'changeTransactionState', transactionId: 'transaction123', state: 'Failure' },
      ]);
      expect(updateCart).toHaveBeenCalledWith(mockCart, [{ action: 'unfreezeCart' }]);
    });

    describe('when easyCredit no longer finds the transaction', () => {
      const openPayment = {
        id: 'payment123',
        transactions: [
          { id: 'tx', interactionId: 'ec', type: CTTransactionType.Authorization, state: CTTransactionState.Initial },
        ],
      };
      const mockCart = { id: 'cart123', cartState: 'Frozen', paymentInfo: { payments: [{ id: 'payment123' }] } };

      beforeEach(() => {
        // @ts-expect-error mocked
        (getPaymentById as jest.Mock).mockResolvedValue(openPayment);
        (validateInitialOrPendingTransaction as jest.Mock).mockReturnValue(openPayment.transactions[0]);
        // @ts-expect-error mocked
        (getCartByPaymentId as jest.Mock).mockResolvedValue(mockCart);
      });

      it('should cancel an expired transaction', async () => {
        const expired = new Errorx({
          code: 'CONSTRAINT_VIOLATION',
          message: 'CONSTRAINT_VIOLATION',
          httpErrorStatus: 400,
          fields: [{ field: 'decision', message: 'The decision for transaction with id ec is invalid' }],
        });
        // @ts-expect-error mocked
        (initEasyCreditClient as jest.Mock).mockReturnValue({ getPayment: jest.fn().mockRejectedValue(expired) });

        await expect(handleCancelPayment('payment123')).resolves.toEqual('payment123');

        expect(updatePayment).toHaveBeenCalledWith(openPayment, [
          { action: 'changeTransactionState', transactionId: 'tx', state: 'Failure' },
        ]);
        expect(updateCart).toHaveBeenCalledWith(mockCart, [{ action: 'unfreezeCart' }]);
      });

      it('should not treat a Pending transaction as expired', async () => {
        const pending = { ...openPayment.transactions[0], state: CTTransactionState.Pending };
        (validateInitialOrPendingTransaction as jest.Mock).mockReturnValue(pending);
        const expired = new Errorx({
          code: 'CONSTRAINT_VIOLATION',
          message: 'CONSTRAINT_VIOLATION',
          httpErrorStatus: 400,
          fields: [{ field: 'decision', message: 'invalid' }],
        });
        // @ts-expect-error mocked
        (initEasyCreditClient as jest.Mock).mockReturnValue({ getPayment: jest.fn().mockRejectedValue(expired) });

        await expect(handleCancelPayment('payment123')).rejects.toBe(expired);
        expect(updatePayment).not.toHaveBeenCalled();
      });

      it('should still fail on any other easyCredit error', async () => {
        const outage = new Errorx({ code: 'Unknown Error', message: 'An error occurred', httpErrorStatus: 503 });
        // @ts-expect-error mocked
        (initEasyCreditClient as jest.Mock).mockReturnValue({ getPayment: jest.fn().mockRejectedValue(outage) });

        await expect(handleCancelPayment('payment123')).rejects.toBe(outage);
        expect(updatePayment).not.toHaveBeenCalled();
        expect(updateCart).not.toHaveBeenCalled();
      });
    });

    describe('when the payment was already cancelled', () => {
      const failedPayment = {
        id: 'payment123',
        transactions: [
          { id: 'transaction123', type: CTTransactionType.Authorization, state: CTTransactionState.Failure },
        ],
      };
      const getECPayment = jest.fn();

      beforeEach(() => {
        // @ts-expect-error mocked
        (getPaymentById as jest.Mock).mockResolvedValue(failedPayment);
        (initEasyCreditClient as jest.Mock).mockReturnValue({ getPayment: getECPayment });
      });

      it('should succeed without calling easyCredit or changing the payment', async () => {
        // @ts-expect-error mocked
        (getCartByPaymentId as jest.Mock).mockResolvedValue({ id: 'cart123', cartState: 'Active' });

        await expect(handleCancelPayment('payment123')).resolves.toEqual('payment123');

        expect(validateInitialOrPendingTransaction).not.toHaveBeenCalled();
        expect(getECPayment).not.toHaveBeenCalled();
        expect(updatePayment).not.toHaveBeenCalled();
        expect(updateCart).not.toHaveBeenCalled();
      });

      it('should still succeed when the cart cleanup fails', async () => {
        // @ts-expect-error mocked
        (getCartByPaymentId as jest.Mock).mockRejectedValue(new Error('Cart not found.'));

        await expect(handleCancelPayment('payment123')).resolves.toEqual('payment123');
        expect(log.warn).toHaveBeenCalled();
      });

      it('should finish a half-done cancel by unfreezing a still frozen cart', async () => {
        const mockCart = { id: 'cart123', cartState: 'Frozen', paymentInfo: { payments: [{ id: 'payment123' }] } };
        // @ts-expect-error mocked
        (getCartByPaymentId as jest.Mock).mockResolvedValue(mockCart);

        await expect(handleCancelPayment('payment123')).resolves.toEqual('payment123');

        expect(updateCart).toHaveBeenCalledWith(mockCart, [{ action: 'unfreezeCart' }]);
      });
    });

    it('should unfreeze the cart when the other easyCredit payment on it is already failed', async () => {
      const paymentB = {
        id: 'paymentB',
        transactions: [
          { id: 'txB', interactionId: 'ecB', type: CTTransactionType.Authorization, state: CTTransactionState.Initial },
        ],
      };
      const supersededA = {
        id: 'paymentA',
        paymentMethodInfo: { paymentInterface: 'easycredit' },
        transactions: [{ id: 'txA', type: CTTransactionType.Authorization, state: CTTransactionState.Failure }],
      };
      const mockCart = {
        id: 'cart123',
        cartState: 'Frozen',
        paymentInfo: { payments: [{ id: 'paymentA' }, { id: 'paymentB' }] },
      };
      (getPaymentById as jest.Mock).mockImplementation(async (id) => (id === 'paymentB' ? paymentB : supersededA));
      (validateInitialOrPendingTransaction as jest.Mock).mockReturnValueOnce(paymentB.transactions[0]);
      (initEasyCreditClient as jest.Mock).mockReturnValue({
        // @ts-expect-error mocked
        getPayment: jest.fn().mockResolvedValue({ status: ECTransactionStatus.OPEN }),
      });
      // @ts-expect-error mocked
      (getCartByPaymentId as jest.Mock).mockResolvedValue(mockCart);

      await expect(handleCancelPayment('paymentB')).resolves.toEqual('paymentB');

      expect(updateCart).toHaveBeenCalledWith(mockCart, [{ action: 'unfreezeCart' }]);
    });

    it('should not unfreeze the cart while another payment on it is still in progress', async () => {
      const stalePayment = {
        id: 'paymentA',
        transactions: [
          { id: 'txA', interactionId: 'ecA', type: CTTransactionType.Authorization, state: CTTransactionState.Initial },
        ],
      };
      const activePayment = {
        id: 'paymentB',
        paymentMethodInfo: { paymentInterface: 'easycredit' },
        transactions: [
          { id: 'txB', interactionId: 'ecB', type: CTTransactionType.Authorization, state: CTTransactionState.Initial },
        ],
      };
      const mockCart = {
        id: 'cart123',
        cartState: 'Frozen',
        paymentInfo: { payments: [{ id: 'paymentA' }, { id: 'paymentB' }] },
      };
      (getPaymentById as jest.Mock).mockImplementation(async (id) =>
        id === 'paymentA' ? stalePayment : activePayment,
      );
      (validateInitialOrPendingTransaction as jest.Mock).mockReturnValue(stalePayment.transactions[0]);
      (initEasyCreditClient as jest.Mock).mockReturnValue({
        // @ts-expect-error mocked
        getPayment: jest.fn().mockResolvedValue({ status: ECTransactionStatus.OPEN }),
      });
      // @ts-expect-error mocked
      (getCartByPaymentId as jest.Mock).mockResolvedValue(mockCart);

      await expect(handleCancelPayment('paymentA')).resolves.toEqual('paymentA');

      expect(updatePayment).toHaveBeenCalledWith(stalePayment, [
        { action: 'changeTransactionState', transactionId: 'txA', state: 'Failure' },
      ]);
      expect(updateCart).not.toHaveBeenCalled();
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
        transactions: [
          {
            id: 'transactionId',
            interactionId: 'transactionId123',
            custom: { fields: { easyCreditTechnicalTransactionId: 'easyCreditTechnicalTransactionId' } },
          },
        ],
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

      await handleCapturePayment('payment123', 'trackingNumber');

      expect(initEasyCreditClient().capturePayment).toHaveBeenCalledWith(
        'transactionId123',
        'payment123',
        'trackingNumber',
      );
      expect(initEasyCreditClient().getPayment).toHaveBeenCalledWith('easyCreditTechnicalTransactionId');
    });

    it('should throw and log error if payment capture fails', async () => {
      const mockError = new Error('Capture failed');
      // @ts-expect-error mocked
      (getPaymentById as jest.Mock).mockRejectedValue(mockError);

      await expect(handleCapturePayment('payment123')).rejects.toThrow('Capture failed');
      expect(log.error).toHaveBeenCalledWith('Error in capturing payment', mockError);
    });
  });

  describe('handleRefundPayment', () => {
    it('should successfully refund a payment', async () => {
      const mockPayment = {
        id: 'payment123',
        transactions: [
          {
            id: 'transactionId',
            interactionId: 'transactionId123',
            custom: { fields: { easyCreditTechnicalTransactionId: 'easyCreditTechnicalTransactionId' } },
          },
        ],
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
        refundPayment: jest.fn().mockResolvedValue(true),
        // @ts-expect-error mocked
        getPayment: jest.fn().mockResolvedValue(mockECTransaction),
      });
      (validatePaymentAmount as jest.Mock).mockReturnValue(true);
      (validatePayment as jest.Mock).mockReturnValue(true);
      (validateSuccessTransaction as jest.Mock).mockReturnValue(true);
      (validateInitialRefundTransaction as jest.Mock).mockReturnValue(mockPayment.transactions[0]);

      await handleRefundPayment('payment123', 10);

      expect(initEasyCreditClient().refundPayment).toHaveBeenCalledWith('transactionId123', {
        value: 10,
        bookingId: 'transactionId',
      });
    });

    it('should throw and log error if payment refund fails', async () => {
      const mockError = new Error('Refund failed');
      // @ts-expect-error mocked
      (getPaymentById as jest.Mock).mockRejectedValue(mockError);

      await expect(handleRefundPayment('payment123', 10)).rejects.toThrow('Refund failed');
      expect(log.error).toHaveBeenCalledWith('Error in refunding payment', mockError);
    });
  });
});
