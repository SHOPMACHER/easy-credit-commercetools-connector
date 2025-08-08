import {
  createPayment,
  getPaymentByEasyCreditRefundBookingId,
  getPaymentById,
  updatePayment,
} from '../../src/commercetools/payment.commercetools';
import { createApiRoot } from '../../src/client/create.client';
import { log } from '../../src/libs/logger';
import { Errorx, Payment } from '@commercetools/connect-payments-sdk';
import { CTTransactionState, CTTransactionType } from '../../src/types/payment.types';
import { PaymentUpdateAction } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/payment';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('../../src/client/create.client');
jest.mock('../../src/libs/logger');

describe('Payment Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getPaymentById', () => {
    it('should return payment object when API call succeeds', async () => {
      const mockPayment = { id: 'payment123', version: 1 };
      const mockApiResponse = { body: mockPayment };
      (createApiRoot as jest.Mock).mockReturnValue({
        payments: () => ({
          withId: () => ({
            get: () => ({
              // @ts-expect-error mocked
              execute: jest.fn().mockResolvedValue(mockApiResponse),
            }),
          }),
        }),
      });

      const result = await getPaymentById('payment123');

      expect(result).toEqual(mockPayment);
      expect(createApiRoot).toHaveBeenCalled();
    });

    it('should log error and throw Errorx when API call fails', async () => {
      const mockError = {
        code: '400',
        body: {
          message: 'Payment not found',
          errors: [{ code: 'InvalidOperation' }],
        },
        statusCode: 400,
      };
      (createApiRoot as jest.Mock).mockReturnValue({
        payments: () => ({
          withId: () => ({
            get: () => ({
              // @ts-expect-error mocked
              execute: jest.fn().mockRejectedValue(mockError),
            }),
          }),
        }),
      });

      await expect(getPaymentById('payment123')).rejects.toThrow(Errorx);

      expect(log.error).toHaveBeenCalledWith('Error in getting CommerceTools Payment', mockError);
    });
  });

  describe('updatePayment', () => {
    it('should update and return the updated payment when API call succeeds', async () => {
      const mockPayment: Payment = {
        id: 'payment123',
        version: 2,
        createdAt: '',
        lastModifiedAt: '',
        amountPlanned: {
          currencyCode: 'EUR',
          centAmount: 1000,
          type: 'centPrecision',
          fractionDigits: 2,
        },
        paymentMethodInfo: {},
        paymentStatus: {},
        transactions: [],
        interfaceInteractions: [],
      };
      const mockUpdateActions: PaymentUpdateAction[] = [
        {
          action: 'addTransaction',
          transaction: {
            state: CTTransactionState.Success,
            type: CTTransactionType.Authorization,
            amount: {
              currencyCode: 'EUR',
              centAmount: 1000,
              type: 'centPrecision',
              fractionDigits: 2,
            },
            interactionId: '1',
          },
        },
      ];
      const mockApiResponse = { body: mockPayment };
      (createApiRoot as jest.Mock).mockReturnValue({
        payments: () => ({
          withId: () => ({
            post: () => ({
              // @ts-expect-error mocked
              execute: jest.fn().mockResolvedValue(mockApiResponse),
            }),
          }),
        }),
      });

      const result = await updatePayment(mockPayment, mockUpdateActions);

      expect(result).toEqual(mockPayment);
      expect(createApiRoot).toHaveBeenCalled();
    });

    it('should log error and throw Errorx when API call fails', async () => {
      const mockPayment: Payment = {
        id: 'payment123',
        version: 2,
        createdAt: '',
        lastModifiedAt: '',
        amountPlanned: {
          currencyCode: 'EUR',
          centAmount: 1000,
          type: 'centPrecision',
          fractionDigits: 2,
        },
        paymentMethodInfo: {},
        paymentStatus: {},
        transactions: [],
        interfaceInteractions: [],
      };
      const mockUpdateActions: PaymentUpdateAction[] = [
        {
          action: 'addTransaction',
          transaction: {
            state: CTTransactionState.Success,
            type: CTTransactionType.Authorization,
            amount: {
              currencyCode: 'EUR',
              centAmount: 1000,
              type: 'centPrecision',
              fractionDigits: 2,
            },
            interactionId: '1',
          },
        },
      ];
      const mockError = {
        code: '400',
        body: {
          message: 'Update failed',
          errors: [{ code: 'InvalidVersion' }],
        },
        statusCode: 400,
      };
      (createApiRoot as jest.Mock).mockReturnValue({
        payments: () => ({
          withId: () => ({
            post: () => ({
              // @ts-expect-error mocked
              execute: jest.fn().mockRejectedValue(mockError),
            }),
          }),
        }),
      });

      await expect(updatePayment(mockPayment, mockUpdateActions)).rejects.toThrow(Errorx);

      expect(log.error).toHaveBeenCalledWith('Error in updatePayment', mockError);
    });
  });

  describe('createPayment', () => {
    it('should create and return a payment when API call succeeds', async () => {
      const mockPaymentDraft = { amountPlanned: { currencyCode: 'EUR', centAmount: 1000 } };
      const mockPayment = { id: 'payment123', version: 1 };
      const mockApiResponse = { body: mockPayment };
      (createApiRoot as jest.Mock).mockReturnValue({
        payments: () => ({
          post: () => ({
            // @ts-expect-error mocked
            execute: jest.fn().mockResolvedValue(mockApiResponse),
          }),
        }),
      });

      const result = await createPayment(mockPaymentDraft);

      expect(result).toEqual(mockPayment);
      expect(createApiRoot).toHaveBeenCalled();
    });

    it('should log error and throw Errorx when API call fails', async () => {
      const mockPaymentDraft = { amountPlanned: { currencyCode: 'EUR', centAmount: 1000 } };
      const mockError = {
        code: '400',
        body: {
          message: 'Payment creation failed',
          errors: [{ code: 'InvalidField' }],
        },
        statusCode: 400,
      };
      (createApiRoot as jest.Mock).mockReturnValue({
        payments: () => ({
          post: () => ({
            // @ts-expect-error mocked
            execute: jest.fn().mockRejectedValue(mockError),
          }),
        }),
      });

      await expect(createPayment(mockPaymentDraft)).rejects.toThrow(Errorx);

      expect(log.error).toHaveBeenCalledWith('Error in createPayment', mockError);
    });
  });

  describe('getPaymentByEasyCreditRefundBookingId', () => {
    it('should return payment object when API call succeeds', async () => {
      const getPayments = jest.fn();

      const payment = {
        id: 'payment',
      } as Payment;

      (createApiRoot as jest.Mock).mockReturnValue({
        payments: jest.fn().mockReturnValue({
          get: getPayments,
        }),
      });

      getPayments.mockReturnValue({
        execute: jest.fn().mockReturnValue({
          body: {
            results: [payment],
          },
        }),
      });

      const ecRefundBookingId = 'transaction1';

      const result = await getPaymentByEasyCreditRefundBookingId(ecRefundBookingId);

      expect(getPayments).toHaveBeenCalledTimes(1);
      expect(getPayments).toHaveBeenCalledWith({
        queryArgs: {
          where: `transactions(id="${ecRefundBookingId}")`,
        },
      });
      expect(result).toStrictEqual(payment);
      expect(log.info).toHaveBeenCalledTimes(1);
      expect(log.info).toHaveBeenCalledWith(`Found payment with id ${payment.id}`);
    });

    it('getPaymentByEasyCreditRefundBookingId should throw exception', async () => {
      const getPayments = jest.fn();

      (createApiRoot as jest.Mock).mockReturnValue({
        payments: jest.fn().mockReturnValue({
          get: getPayments,
        }),
      });

      getPayments.mockReturnValue({
        execute: jest.fn().mockReturnValue({
          body: {
            results: [],
          },
        }),
      });

      const ecRefundBookingId = 'transaction1';

      try {
        await getPaymentByEasyCreditRefundBookingId(ecRefundBookingId);
      } catch (error: any) {
        expect(getPayments).toHaveBeenCalledTimes(1);
        expect(getPayments).toHaveBeenCalledWith({
          queryArgs: {
            where: `transactions(id="${ecRefundBookingId}")`,
          },
        });
        expect(error).toBeInstanceOf(Errorx);
        expect(error.httpErrorStatus).toBe(404);
        expect(error.message).toBe('There is not any assigned payment');
        expect(log.error).toHaveBeenCalledTimes(1);
        expect(log.error).toHaveBeenCalledWith('There is not any assigned payment');
      }
    });
  });
});
