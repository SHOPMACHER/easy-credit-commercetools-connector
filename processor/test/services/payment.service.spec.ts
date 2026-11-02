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
  validatePaymentTypeAvailability,
  validatePrivateCustomer,
  validateRefundAmount,
  validateShippingDestinations,
  validateSuccessTransaction,
  validateTransaction,
} from '../../src/validators/payment.validators';
import { readConfiguration } from '../../src/utils/config.utils';
import {
  getPaymentType,
  getPendingCaptureTransactions,
  getSuccessCaptureTransactions,
  getSuccessTransaction,
  getTransaction,
} from '../../src/utils/payment.utils';
import { Errorx, MultiErrorx } from '@commercetools/connect-payments-sdk';
import {
  CTTransactionState,
  CTTransactionType,
  ECTransactionCustomerRelationship,
  ECTransactionPaymentType,
  ECTransactionStatus,
  PaymentTypesAvailability,
} from '../../src/types/payment.types';
import {
  getShippingAddress,
  getShippingDestinations,
  mapCreatePaymentResponse,
  mapCTCartToCTPayment,
  mapCTCartToECPayment,
} from '../../src/utils/map.utils';
import { getPaymentTypesAvailability } from '../../src/services/webshop.service';
import { getPaymentTypeExclusion } from '../../src/services/paymentTypeRestriction.service';
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
  validatePaymentTypeAvailability: jest.fn(),
  validatePrivateCustomer: jest.fn(),
  validateShippingDestinations: jest.fn(),
  paymentTypeNotAvailableError: jest.requireActual<typeof import('../../src/validators/payment.validators')>(
    '../../src/validators/payment.validators',
  ).paymentTypeNotAvailableError,
  validatePayment: jest.fn(),
  validatePendingTransaction: jest.fn(),
  validateSuccessTransaction: jest.fn(),
  validateTransaction: jest.fn(),
  validateInitialOrPendingTransaction: jest.fn(),
  validateRefundAmount: jest.fn(),
  validateInitialRefundTransaction: jest.fn(),
}));
jest.mock('../../src/utils/map.utils');
jest.mock('../../src/utils/config.utils', () => ({
  getPaymentTypeConfig:
    jest.requireActual<typeof import('../../src/utils/config.utils')>('../../src/utils/config.utils')
      .getPaymentTypeConfig,
  readConfiguration: jest.fn().mockReturnValue({
    easyCredit: { webShopId: 'webShopId123', billPaymentEnabled: '1' },
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
jest.mock('../../src/services/webshop.service');
jest.mock('../../src/services/paymentTypeRestriction.service');

const allPaymentTypesAvailable: PaymentTypesAvailability = {
  INSTALLMENT_PAYMENT: { enabled: true, available: true, minAmount: 200, maxAmount: 10000 },
  BILL_PAYMENT: { enabled: true, available: true, minAmount: 50, maxAmount: 5000 },
};

beforeEach(() => {
  // @ts-expect-error mocked
  (getPaymentTypesAvailability as jest.Mock).mockResolvedValue(allPaymentTypesAvailable);
  jest.mocked(getPaymentTypeExclusion).mockResolvedValue({ productTypeKeys: [], customLineItems: [] });
});

describe('Payment handlers', () => {
  // --clearMocks keeps implementations; reset this one so tests that use the real getTransaction don't leak.
  afterEach(() => {
    (getTransaction as jest.Mock).mockReset();
  });

  describe('handlePaymentMethod', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    afterEach(() => {
      // Bill tests that fail on availability leave a queued private customer error unused
      (validatePrivateCustomer as jest.Mock).mockReset();
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
        'INSTALLMENT_PAYMENT',
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
        'INSTALLMENT_PAYMENT',
      );
    });

    it('should check the availability before the address or currency for installment too', async () => {
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue({
        totalPrice: { currencyCode: 'USD', centAmount: 50000, fractionDigits: 2 },
      });
      (validateCurrency as jest.Mock).mockImplementationOnce((currencyCode, ecConfig, errors) => {
        // @ts-expect-error mocked
        errors.push(new Errorx({ httpErrorStatus: 400, code: 'InvalidCurrency', message: 'Invalid currency' }));
      });

      await expect(handlePaymentMethod('cart123')).rejects.toMatchObject({
        errors: [expect.objectContaining({ code: 'InvalidCurrency' })],
      });
      expect(getPaymentTypesAvailability).toHaveBeenCalled();
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

    it('should validate the requested bill payment type and the private customer', async () => {
      const mockCart = {
        billingAddress: {},
        shippingAddress: {},
        totalPrice: { currencyCode: 'EUR', centAmount: 50000, fractionDigits: 2 },
      };
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue(mockCart);
      const shippingDestinations = [mockCart.shippingAddress];
      (getShippingAddress as jest.Mock).mockReturnValue(mockCart.shippingAddress);
      (getShippingDestinations as jest.Mock).mockReturnValue(shippingDestinations);

      await handlePaymentMethod('cart123', ECTransactionPaymentType.ECTransactionBillPayment);

      expect(validateShippingDestinations).toHaveBeenCalledWith(
        mockCart.billingAddress,
        shippingDestinations,
        { webShopId: 'webShopId123' },
        expect.any(Array),
      );
      expect(validatePrivateCustomer).toHaveBeenCalledWith(
        mockCart,
        shippingDestinations,
        { webShopId: 'webShopId123' },
        expect.any(Array),
      );
      expect(validatePaymentTypeAvailability).toHaveBeenCalledWith(
        500,
        allPaymentTypesAvailable.BILL_PAYMENT,
        { webShopId: 'webShopId123' },
        expect.any(Array),
        'BILL_PAYMENT',
      );
    });

    it('should report bill payment as unavailable before any cart error', async () => {
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue({
        totalPrice: { currencyCode: 'EUR', centAmount: 50000, fractionDigits: 2 },
      });
      (validatePaymentTypeAvailability as jest.Mock).mockImplementationOnce(
        (amount, availability, ecConfig, errors) => {
          // @ts-expect-error mocked
          errors.push(new Errorx({ httpErrorStatus: 400, code: 'PaymentTypeNotAvailable', message: 'Not available' }));
        },
      );
      (validatePrivateCustomer as jest.Mock).mockImplementationOnce((cart, shippingAddress, ecConfig, errors) => {
        // @ts-expect-error mocked
        errors.push(new Errorx({ httpErrorStatus: 400, code: 'CorporateCustomerNotAllowed', message: 'Corporate' }));
      });

      const error = await handlePaymentMethod('cart123', ECTransactionPaymentType.ECTransactionBillPayment).catch(
        (e: unknown) => e,
      );

      expect((error as MultiErrorx).errors.map(({ code }) => code)).toEqual(['PaymentTypeNotAvailable']);
      expect(validateAddresses).not.toHaveBeenCalled();
      expect(validatePrivateCustomer).not.toHaveBeenCalled();
    });

    it('should report only a failed availability check, without the cart errors', async () => {
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue({
        totalPrice: { currencyCode: 'EUR', centAmount: 50000, fractionDigits: 2 },
      });
      (validatePaymentTypeAvailability as jest.Mock).mockImplementationOnce(
        (amount, availability, ecConfig, errors) => {
          // @ts-expect-error mocked
          errors.push(new Errorx({ httpErrorStatus: 503, code: 'BillPaymentCheckFailed', message: 'Check failed' }));
        },
      );
      (validatePrivateCustomer as jest.Mock).mockImplementationOnce((cart, shippingAddress, ecConfig, errors) => {
        // @ts-expect-error mocked
        errors.push(new Errorx({ httpErrorStatus: 400, code: 'CorporateCustomerNotAllowed', message: 'Corporate' }));
      });

      const error = await handlePaymentMethod('cart123', ECTransactionPaymentType.ECTransactionBillPayment).catch(
        (e: unknown) => e,
      );

      expect((error as MultiErrorx).errors.map(({ code }) => code)).toEqual(['BillPaymentCheckFailed']);
      expect(validateAddresses).not.toHaveBeenCalled();
      expect(validatePrivateCustomer).not.toHaveBeenCalled();
    });

    it('should report cart errors for an available bill payment', async () => {
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue({
        totalPrice: { currencyCode: 'EUR', centAmount: 50000, fractionDigits: 2 },
      });
      (validatePrivateCustomer as jest.Mock).mockImplementationOnce((cart, shippingAddress, ecConfig, errors) => {
        // @ts-expect-error mocked
        errors.push(new Errorx({ httpErrorStatus: 400, code: 'CorporateCustomerNotAllowed', message: 'Corporate' }));
      });

      const error = await handlePaymentMethod('cart123', ECTransactionPaymentType.ECTransactionBillPayment).catch(
        (e: unknown) => e,
      );

      expect((error as MultiErrorx).errors.map(({ code }) => code)).toEqual(['CorporateCustomerNotAllowed']);
      expect(getPaymentTypesAvailability).toHaveBeenCalledWith(500);
    });

    it('should not apply the private customer check to installment payment', async () => {
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue({
        totalPrice: { currencyCode: 'EUR', centAmount: 50000, fractionDigits: 2 },
      });

      await handlePaymentMethod('cart123', ECTransactionPaymentType.ECTransactionInstallmentPayment);

      expect(validatePrivateCustomer).not.toHaveBeenCalled();
      expect(validatePaymentTypeAvailability).toHaveBeenCalledWith(
        500,
        allPaymentTypesAvailable.INSTALLMENT_PAYMENT,
        { webShopId: 'webShopId123' },
        expect.any(Array),
        'INSTALLMENT_PAYMENT',
      );
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
      expect(log.error).not.toHaveBeenCalled();
    });

    it('should rethrow any unknown error and leave logging to the error handler', async () => {
      const error = new Error('Unexpected error');
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockRejectedValue(error);

      await expect(handlePaymentMethod('cart123')).rejects.toThrow(error);
      expect(log.error).not.toHaveBeenCalled();
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
      const mockCart = {
        cartState: 'Active',
        lineItems: [],
        customLineItems: [],
        totalPrice: { currencyCode: 'EUR', centAmount: 1000 },
      };
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
      (readConfiguration as jest.Mock).mockReturnValue({
        easyCredit: { webShopId: 'webShopId123', billPaymentEnabled: '1' },
      });
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
      const mockCart = {
        cartState: 'Active',
        lineItems: [],
        customLineItems: [],
        totalPrice: { currencyCode: 'EUR', centAmount: 1000 },
      };
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
      const mockCart = {
        cartState: 'Active',
        lineItems: [],
        customLineItems: [],
        totalPrice: { currencyCode: 'EUR', centAmount: 1000 },
      };
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
      const mockCart = {
        cartState: 'Active',
        lineItems: [],
        customLineItems: [],
        totalPrice: { currencyCode: 'EUR', centAmount: 1000 },
      };
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
        lineItems: [],
        customLineItems: [],
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
      (readConfiguration as jest.Mock).mockReturnValue({
        easyCredit: { webShopId: 'webShopId123', billPaymentEnabled: '1' },
      });

      await handleCreatePayment('cart123', redirectLinks, customerRelationship);

      expect(validatePaymentTypeAvailability).toHaveBeenCalledWith(
        500,
        allPaymentTypesAvailable.INSTALLMENT_PAYMENT,
        { webShopId: 'webShopId123' },
        expect.any(Array),
        'INSTALLMENT_PAYMENT',
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
      const mockCart = {
        cartState: 'Active',
        lineItems: [],
        customLineItems: [],
        totalPrice: { currencyCode: 'EUR', centAmount: 50000 },
      };
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
      const activeCart = { id: 'cart123', cartState: 'Active', lineItems: [], customLineItems: [], totalPrice };
      const frozenCart = { ...activeCart, cartState: 'Frozen', freezeStrategy: 'HardFreeze' };
      const ctPayment = { id: 'payment123' };
      const positiveECPayment = { transactionInformation: { decision: { decisionOutcome: 'POSITIVE' } } };
      const freezeActions = [{ action: 'freezeCart' }];
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
          'BILL_PAYMENT',
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
          expect.anything(),
        );
      });

      it('should freeze an active cart with the default strategy', async () => {
        await handleCreatePayment('cart123', redirectLinks, customerRelationship);

        expect(updateCart).toHaveBeenNthCalledWith(1, activeCart, freezeActions);
      });

      it.each([
        ['HardFreeze', frozenCart],
        ['SoftFreeze', { ...activeCart, cartState: 'Frozen', freezeStrategy: 'SoftFreeze' }],
        ['a missing strategy', { ...activeCart, cartState: 'Frozen' }],
      ])('should not freeze again a cart frozen with %s', async (_, cart) => {
        (getCartById as jest.Mock).mockResolvedValue(cart as never);

        await handleCreatePayment('cart123', redirectLinks, customerRelationship);

        expect(updateCart).toHaveBeenCalledTimes(1);
        expect(updateCart).toHaveBeenCalledWith(cart, [
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

    it('should refuse to cancel a payment that is already authorized in commercetools, without writes', async () => {
      const authorized = {
        id: 'payment123',
        transactions: [{ id: 'tx', type: CTTransactionType.Authorization, state: CTTransactionState.Success }],
      };
      // @ts-expect-error mocked
      (getPaymentById as jest.Mock).mockResolvedValue(authorized);
      const ecClient = { getPayment: jest.fn() };
      (initEasyCreditClient as jest.Mock).mockReturnValue(ecClient);

      await expect(handleCancelPayment('payment123')).rejects.toMatchObject({ code: 'TransactionIsAuthorized' });
      expect(ecClient.getPayment).not.toHaveBeenCalled();
      expect(updatePayment).not.toHaveBeenCalled();
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
        capturePayment: jest.fn().mockResolvedValue(undefined),
        // @ts-expect-error mocked
        getPayment: jest.fn().mockResolvedValue(mockECTransaction),
      });
      (validatePayment as jest.Mock).mockReturnValue(true);
      (validateSuccessTransaction as jest.Mock).mockReturnValue(true);
      (getSuccessTransaction as jest.Mock).mockReturnValue(mockPayment.transactions[0]);
      (getSuccessCaptureTransactions as jest.Mock).mockReturnValue([]);
      (getPendingCaptureTransactions as jest.Mock).mockReturnValue([]);
      // @ts-expect-error mocked
      (updatePayment as jest.Mock).mockResolvedValue(mockPayment);

      await handleCapturePayment('payment123', 'trackingNumber');

      expect(initEasyCreditClient().capturePayment).toHaveBeenCalledWith(
        'transactionId123',
        'payment123',
        'trackingNumber',
      );
      expect(initEasyCreditClient().getPayment).toHaveBeenCalledWith(
        'easyCreditTechnicalTransactionId',
        expect.any(AbortSignal),
      );
    });

    it('should pass the error on without logging it again', async () => {
      jest.mocked(log.error).mockClear();
      const mockError = new Error('Capture failed');
      // @ts-expect-error mocked
      (getPaymentById as jest.Mock).mockRejectedValue(mockError);

      await expect(handleCapturePayment('payment123')).rejects.toBe(mockError);
      expect(log.error).not.toHaveBeenCalled();
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
        refundPayment: jest.fn().mockResolvedValue(undefined),
        // @ts-expect-error mocked
        getPayment: jest.fn().mockResolvedValue(mockECTransaction),
      });
      (validateRefundAmount as jest.Mock).mockReturnValue(1000);
      (validatePayment as jest.Mock).mockReturnValue(true);
      (validateSuccessTransaction as jest.Mock).mockReturnValue(true);
      (validateInitialRefundTransaction as jest.Mock).mockReturnValue(mockPayment.transactions[0]);

      await handleRefundPayment('payment123', 10);

      expect(initEasyCreditClient().refundPayment).toHaveBeenCalledWith('transactionId123', {
        value: 10,
        bookingId: 'transactionId',
      });
    });

    it('should pass the error on without logging it again', async () => {
      jest.mocked(log.error).mockClear();
      const mockError = new Error('Refund failed');
      // @ts-expect-error mocked
      (getPaymentById as jest.Mock).mockRejectedValue(mockError);

      await expect(handleRefundPayment('payment123', 10)).rejects.toBe(mockError);
      expect(log.error).not.toHaveBeenCalled();
    });
  });
});
