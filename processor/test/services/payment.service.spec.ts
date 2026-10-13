import {
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
  validateCurrency,
  validateInitialOrPendingTransaction,
  validateInitialRefundTransaction,
  validatePayment,
  validatePaymentAmount,
  validatePaymentTypeAvailability,
  validateSuccessTransaction,
  validateTransaction,
} from '../../src/validators/payment.validators';
import { readConfiguration } from '../../src/utils/config.utils';
import { getPaymentType, getSuccessTransaction, getTransaction } from '../../src/utils/payment.utils';
import { Errorx, MultiErrorx } from '@commercetools/connect-payments-sdk';
import {
  CTTransactionState,
  CTTransactionType,
  ECTransactionCustomerRelationship,
  ECTransactionPaymentType,
  ECTransactionStatus,
  PaymentTypesAvailability,
} from '../../src/types/payment.types';
import { mapCreatePaymentResponse, mapCTCartToCTPayment, mapCTCartToECPayment } from '../../src/utils/map.utils';
import { getPaymentTypesAvailability } from '../../src/services/webshop.service';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('../../src/commercetools/cart.commercetools');
jest.mock('../../src/commercetools/payment.commercetools');
jest.mock('../../src/client/easycredit.client');
jest.mock('../../src/libs/logger');
jest.mock('../../src/validators/payment.validators', () => ({
  validateAddresses: jest.fn(),
  validateCurrency: jest.fn(),
  validatePaymentTypeAvailability: jest.fn(),
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
jest.mock('../../src/services/webshop.service');

const allPaymentTypesAvailable: PaymentTypesAvailability = {
  INSTALLMENT_PAYMENT: { enabled: true, available: true, minAmount: 200, maxAmount: 10000 },
  BILL_PAYMENT: { enabled: true, available: true, minAmount: 50, maxAmount: 5000 },
};

beforeEach(() => {
  // @ts-expect-error mocked
  (getPaymentTypesAvailability as jest.Mock).mockResolvedValue(allPaymentTypesAvailable);
});

describe('Payment handlers', () => {
  describe('handlePaymentMethod', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return the payment method with the available payment types', async () => {
      const mockCart = {
        billingAddress: {},
        shippingAddress: {},
        totalPrice: { currencyCode: 'EUR', centAmount: 50000, fractionDigits: 2 },
      };
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue(mockCart);

      const result = await handlePaymentMethod('cart123');

      expect(result).toEqual({ webShopId: 'webShopId123', amount: 500, paymentTypes: allPaymentTypesAvailable });
      expect(getCartById).toHaveBeenCalledWith('cart123');
      expect(getPaymentTypesAvailability).toHaveBeenCalledWith(500);
      expect(validatePaymentTypeAvailability).toHaveBeenCalledWith(
        500,
        allPaymentTypesAvailable.INSTALLMENT_PAYMENT,
        { webShopId: 'webShopId123' },
        expect.any(Array),
      );
    });

    it('should validate installment even if bill payment is available', async () => {
      const paymentTypes = {
        INSTALLMENT_PAYMENT: { enabled: true, available: false, minAmount: 200, maxAmount: 10000 },
        BILL_PAYMENT: { enabled: true, available: true, minAmount: 50, maxAmount: 5000 },
      };
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue({
        totalPrice: { currencyCode: 'EUR', centAmount: 10000, fractionDigits: 2 },
      });
      // @ts-expect-error mocked
      (getPaymentTypesAvailability as jest.Mock).mockResolvedValue(paymentTypes);
      (validatePaymentTypeAvailability as jest.Mock).mockImplementationOnce(
        (amount, availability, ecConfig, errors) => {
          // @ts-expect-error mocked
          errors.push(new Errorx({ httpErrorStatus: 400, code: 'InvalidAmount', message: 'Invalid amount' }));
        },
      );

      await expect(handlePaymentMethod('cart123')).rejects.toThrow(MultiErrorx);
      expect(validatePaymentTypeAvailability).toHaveBeenCalledWith(
        100,
        paymentTypes.INSTALLMENT_PAYMENT,
        { webShopId: 'webShopId123' },
        expect.any(Array),
      );
    });

    it('should not fetch the webshop info if the address or currency is invalid', async () => {
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue({
        totalPrice: { currencyCode: 'USD', centAmount: 50000, fractionDigits: 2 },
      });
      (validateCurrency as jest.Mock).mockImplementationOnce((currencyCode, ecConfig, errors) => {
        // @ts-expect-error mocked
        errors.push(new Errorx({ httpErrorStatus: 400, code: 'InvalidCurrency', message: 'Invalid currency' }));
      });

      await expect(handlePaymentMethod('cart123')).rejects.toThrow(MultiErrorx);
      expect(getPaymentTypesAvailability).not.toHaveBeenCalled();
    });

    it('should rethrow an EasyCreditUnavailable error', async () => {
      const error = new Errorx({ httpErrorStatus: 503, code: 'EasyCreditUnavailable', message: 'Unavailable' });
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue({
        totalPrice: { currencyCode: 'EUR', centAmount: 50000, fractionDigits: 2 },
      });
      // @ts-expect-error mocked
      (getPaymentTypesAvailability as jest.Mock).mockRejectedValueOnce(error);

      await expect(handlePaymentMethod('cart123')).rejects.toBe(error);
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

    afterEach(() => {
      (getPaymentType as jest.Mock).mockReset();
    });

    it.each([
      [ECTransactionPaymentType.ECTransactionBillPayment],
      [ECTransactionPaymentType.ECTransactionInstallmentPayment],
    ])('should return paymentType %s derived from the CT payment', async (paymentType) => {
      // @ts-expect-error mocked
      (getPaymentById as jest.Mock).mockResolvedValue(mockPayment);
      (getTransaction as jest.Mock).mockReturnValue(mockTransaction);
      (getPaymentType as jest.Mock).mockReturnValue(paymentType);
      // @ts-expect-error mocked
      (initEasyCreditClient as jest.Mock).mockReturnValue({ getPayment: jest.fn().mockResolvedValue(mockECResponse) });

      const result = await handleGetPayment(mockPaymentId);

      expect(getPaymentType).toHaveBeenCalledWith(mockPayment);
      expect(result.paymentType).toBe(paymentType);
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
    beforeEach(() => {
      jest.clearAllMocks();
    });

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
      expect(updateCart).toHaveBeenCalledWith(mockCart, [{ action: 'freezeCart', strategy: 'HardFreeze' }]);
      expect(createPayment).toHaveBeenCalled();
    });

    it('should handle failure of decisionOutcome and unfreeze the cart', async () => {
      const mockCart = { cartState: 'Active', totalPrice: { currencyCode: 'EUR', centAmount: 1000 } };
      const frozenCart = { ...mockCart, cartState: 'Frozen' };
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
      (updateCart as jest.Mock).mockResolvedValue(frozenCart);
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
      expect(updateCart).toHaveBeenCalledWith(frozenCart, [{ action: 'unfreezeCart' }]);
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

    it('should keep the original error if unfreezing the cart fails', async () => {
      const mockCart = { cartState: 'Active', totalPrice: { currencyCode: 'EUR', centAmount: 1000 } };
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue(mockCart);
      (updateCart as jest.Mock)
        // @ts-expect-error mocked
        .mockResolvedValueOnce({ ...mockCart, cartState: 'Frozen' })
        // @ts-expect-error mocked
        .mockRejectedValueOnce(new Error('Unfreeze failed'));
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
      expect(updateCart).toHaveBeenLastCalledWith(expect.anything(), [{ action: 'unfreezeCart' }]);
    });

    it('should validate the installment payment type and pass it to the easyCredit transaction', async () => {
      const mockCart = {
        cartState: 'Active',
        totalPrice: { currencyCode: 'EUR', centAmount: 50000, fractionDigits: 2 },
      };
      const mockPayment = { id: 'payment123' };
      const mockECPayment = { transactionInformation: { decision: { decisionOutcome: 'POSITIVE' } } };
      const redirectLinks = {
        urlSuccess: 'https://example.com/success',
        urlCancellation: 'https://example.com/cancel',
        urlDenial: 'https://example.com/cancel',
      };
      const customerRelationship: ECTransactionCustomerRelationship = {
        customerStatus: 'NEW_CUSTOMER',
        customerSince: '2024-01-01',
        numberOfOrders: 0,
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

      await handleCreatePayment('cart123', redirectLinks, customerRelationship);

      expect(validatePaymentTypeAvailability).toHaveBeenCalledWith(
        500,
        allPaymentTypesAvailable.INSTALLMENT_PAYMENT,
        { webShopId: 'webShopId123' },
        expect.any(Array),
      );
      expect(mapCTCartToECPayment).toHaveBeenCalledWith(
        mockCart,
        mockPayment,
        redirectLinks,
        customerRelationship,
        ECTransactionPaymentType.ECTransactionInstallmentPayment,
      );
    });

    it('should not create a payment if the payment type is not available', async () => {
      const mockCart = { cartState: 'Active', totalPrice: { currencyCode: 'EUR', centAmount: 50000 } };
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue(mockCart);
      // @ts-expect-error mocked
      (updateCart as jest.Mock).mockResolvedValue(mockCart);
      (validatePaymentTypeAvailability as jest.Mock).mockImplementationOnce(
        (amount, availability, ecConfig, errors) => {
          // @ts-expect-error mocked
          errors.push(new Errorx({ httpErrorStatus: 400, code: 'PaymentTypeNotAvailable', message: 'Not available' }));
        },
      );

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
      ).rejects.toThrow(MultiErrorx);
      expect(createPayment).not.toHaveBeenCalled();
      expect(updateCart).not.toHaveBeenCalled();
    });

    describe('payment type, freeze strategy and orphan cleanup', () => {
      const redirectLinks = {
        urlSuccess: 'https://example.com/success',
        urlCancellation: 'https://example.com/cancel',
        urlDenial: 'https://example.com/cancel',
      };
      const customerRelationship: ECTransactionCustomerRelationship = {
        customerStatus: 'NEW_CUSTOMER',
        customerSince: '2024-01-01',
        numberOfOrders: 0,
      };
      const totalPrice = { currencyCode: 'EUR', centAmount: 50000, fractionDigits: 2 };
      const activeCart = { id: 'cart123', cartState: 'Active', totalPrice };
      const frozenCart = { ...activeCart, cartState: 'Frozen', freezeStrategy: 'HardFreeze' };
      const ctPayment = { id: 'payment123' };
      const positiveECPayment = { transactionInformation: { decision: { decisionOutcome: 'POSITIVE' } } };
      const freezeActions = [{ action: 'freezeCart', strategy: 'HardFreeze' }];
      const cleanupActions = [
        { action: 'unfreezeCart' },
        { action: 'removePayment', payment: { typeId: 'payment', id: 'payment123' } },
      ];
      const bill = ECTransactionPaymentType.ECTransactionBillPayment;
      let createECPayment: jest.Mock;

      beforeEach(() => {
        jest.clearAllMocks();
        createECPayment = jest.fn();
        createECPayment.mockResolvedValue(positiveECPayment as never);
        (initEasyCreditClient as jest.Mock).mockReturnValue({ createPayment: createECPayment });
        (getCartById as jest.Mock).mockResolvedValue(activeCart as never);
        (updateCart as jest.Mock).mockResolvedValue(frozenCart as never);
        (createPayment as jest.Mock).mockResolvedValue(ctPayment as never);
        (updatePayment as jest.Mock).mockResolvedValue(ctPayment as never);
        (mapCTCartToCTPayment as jest.Mock).mockReturnValue({ draft: true });
        (mapCTCartToECPayment as jest.Mock).mockResolvedValue({ ec: true } as never);
      });

      afterEach(() => {
        // clearAllMocks keeps implementations, so drop the ones this block queued
        [
          getCartById,
          updateCart,
          createPayment,
          updatePayment,
          mapCTCartToCTPayment,
          mapCTCartToECPayment,
          validatePaymentTypeAvailability,
        ].forEach((mock) => (mock as jest.Mock).mockReset());
      });

      it('should default to the installment payment type', async () => {
        await handleCreatePayment('cart123', redirectLinks, customerRelationship);

        expect(mapCTCartToCTPayment).toHaveBeenCalledWith(
          frozenCart,
          ECTransactionPaymentType.ECTransactionInstallmentPayment,
        );
        expect(createPayment).toHaveBeenCalledWith({ draft: true });
      });

      it('should validate and map a BILL_PAYMENT with the bill availability', async () => {
        await handleCreatePayment('cart123', redirectLinks, customerRelationship, bill);

        expect(validatePaymentTypeAvailability).toHaveBeenCalledWith(
          500,
          allPaymentTypesAvailable.BILL_PAYMENT,
          { webShopId: 'webShopId123' },
          expect.any(Array),
        );
        expect(mapCTCartToCTPayment).toHaveBeenCalledWith(frozenCart, bill);
        expect(mapCTCartToECPayment).toHaveBeenCalledWith(
          expect.anything(),
          ctPayment,
          redirectLinks,
          customerRelationship,
          bill,
        );
        expect(createECPayment).toHaveBeenCalledWith({ ec: true });
      });

      it('should not use the bill availability for the default type', async () => {
        await handleCreatePayment('cart123', redirectLinks, customerRelationship);

        expect(validatePaymentTypeAvailability).not.toHaveBeenCalledWith(
          expect.anything(),
          allPaymentTypesAvailable.BILL_PAYMENT,
          expect.anything(),
          expect.anything(),
        );
      });

      it('should HardFreeze an active cart', async () => {
        await handleCreatePayment('cart123', redirectLinks, customerRelationship);

        expect(updateCart).toHaveBeenNthCalledWith(1, activeCart, freezeActions);
      });

      it.each([
        ['SoftFreeze', { ...activeCart, cartState: 'Frozen', freezeStrategy: 'SoftFreeze' }],
        ['a missing strategy', { ...activeCart, cartState: 'Frozen' }],
      ])('should unfreeze and HardFreeze in one update for a cart frozen with %s', async (_, cart) => {
        (getCartById as jest.Mock).mockResolvedValue(cart as never);

        await handleCreatePayment('cart123', redirectLinks, customerRelationship);

        expect(updateCart).toHaveBeenNthCalledWith(1, cart, [{ action: 'unfreezeCart' }, ...freezeActions]);
      });

      it('should not freeze again a cart that is already HardFrozen', async () => {
        (getCartById as jest.Mock).mockResolvedValue(frozenCart as never);

        await handleCreatePayment('cart123', redirectLinks, customerRelationship);

        expect(updateCart).toHaveBeenCalledTimes(1);
        expect(updateCart).toHaveBeenCalledWith(frozenCart, [
          { action: 'addPayment', payment: { typeId: 'payment', id: 'payment123' } },
        ]);
      });

      it('should leave an already frozen cart untouched when the bill type is not available', async () => {
        (getCartById as jest.Mock).mockResolvedValue({ ...frozenCart, freezeStrategy: 'SoftFreeze' } as never);
        (validatePaymentTypeAvailability as jest.Mock).mockImplementationOnce((_a, _b, _c, errors) => {
          // @ts-expect-error mocked
          errors.push(new Errorx({ httpErrorStatus: 400, code: 'PaymentTypeNotAvailable', message: 'Not available' }));
        });

        await expect(handleCreatePayment('cart123', redirectLinks, customerRelationship, bill)).rejects.toThrow(
          MultiErrorx,
        );

        expect(updateCart).not.toHaveBeenCalled();
        expect(createPayment).not.toHaveBeenCalled();
      });

      it('should unfreeze and remove the orphan payment if the easyCredit call fails', async () => {
        const error = new Error('easyCredit down');
        createECPayment.mockRejectedValue(error as never);

        await expect(handleCreatePayment('cart123', redirectLinks, customerRelationship)).rejects.toThrow(error);

        expect(updateCart).toHaveBeenCalledTimes(3);
        expect(updateCart).toHaveBeenLastCalledWith(frozenCart, cleanupActions);
        expect(updatePayment).not.toHaveBeenCalled();
      });

      it('should unfreeze and remove the orphan payment if building the easyCredit payload fails', async () => {
        const error = new Error('mapping failed');
        (mapCTCartToECPayment as jest.Mock).mockRejectedValue(error as never);

        await expect(handleCreatePayment('cart123', redirectLinks, customerRelationship)).rejects.toThrow(error);

        expect(createECPayment).not.toHaveBeenCalled();
        expect(updateCart).toHaveBeenLastCalledWith(frozenCart, cleanupActions);
      });

      it('should keep the original error if the orphan cleanup fails', async () => {
        const error = new Error('easyCredit down');
        createECPayment.mockRejectedValue(error as never);
        (updateCart as jest.Mock)
          .mockResolvedValueOnce(frozenCart as never)
          .mockResolvedValueOnce(frozenCart as never)
          .mockRejectedValueOnce(new Error('cleanup failed') as never);

        await expect(handleCreatePayment('cart123', redirectLinks, customerRelationship)).rejects.toThrow(error);

        expect(log.error).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ message: 'cleanup failed' }),
        );
      });

      it('should only unfreeze, and keep the payment, on a NEGATIVE decision', async () => {
        createECPayment.mockResolvedValue({
          transactionInformation: { decision: { decisionOutcome: 'NEGATIVE', decisionOutcomeText: 'NEGATIVE' } },
          transactionId: 'tx123',
        } as never);

        await expect(handleCreatePayment('cart123', redirectLinks, customerRelationship, bill)).rejects.toThrow(
          MultiErrorx,
        );

        expect(updateCart).toHaveBeenLastCalledWith(frozenCart, [{ action: 'unfreezeCart' }]);
        expect(updateCart).not.toHaveBeenCalledWith(expect.anything(), cleanupActions);
      });

      it('should unfreeze and remove the payment when the transaction update fails after the easyCredit call', async () => {
        (updatePayment as jest.Mock).mockRejectedValue(new Error('CT down') as never);

        await expect(handleCreatePayment('cart123', redirectLinks, customerRelationship)).rejects.toThrow('CT down');

        expect(updateCart).toHaveBeenLastCalledWith(frozenCart, cleanupActions);
      });

      it('should keep the original error if the cleanup fails after a failed transaction update', async () => {
        (updatePayment as jest.Mock).mockRejectedValue(new Error('CT down') as never);
        (updateCart as jest.Mock)
          .mockResolvedValueOnce(frozenCart as never)
          .mockResolvedValueOnce(frozenCart as never)
          .mockRejectedValueOnce(new Error('cleanup failed') as never);

        await expect(handleCreatePayment('cart123', redirectLinks, customerRelationship)).rejects.toThrow('CT down');
      });

      it('should not clean up when the transaction update succeeds', async () => {
        await handleCreatePayment('cart123', redirectLinks, customerRelationship);

        expect(updateCart).toHaveBeenCalledTimes(2);
        expect(updateCart).not.toHaveBeenCalledWith(expect.anything(), cleanupActions);
      });

      it('should write a Failure transaction and not remove the payment on a NEGATIVE decision', async () => {
        createECPayment.mockResolvedValue({
          transactionInformation: { decision: { decisionOutcome: 'NEGATIVE', decisionOutcomeText: 'NEGATIVE' } },
          transactionId: 'tx123',
        } as never);

        await expect(handleCreatePayment('cart123', redirectLinks, customerRelationship)).rejects.toThrow(MultiErrorx);

        expect(updatePayment).toHaveBeenCalledWith(
          ctPayment,
          expect.arrayContaining([
            expect.objectContaining({
              action: 'addTransaction',
              transaction: expect.objectContaining({ state: CTTransactionState.Failure }),
            }),
          ]),
        );
        expect(updateCart).not.toHaveBeenCalledWith(expect.anything(), cleanupActions);
      });
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
        { action: 'changeTransactionState', transactionId: 'transaction123', state: 'Failure' },
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
