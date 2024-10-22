import { getPaymentById, updatePayment, createPayment } from '../../src/commercetools/payment.commercetools';
import { createApiRoot } from '../../src/client/create.client';
import { log } from '../../src/libs/logger';
import { Errorx, Payment } from '@commercetools/connect-payments-sdk';
import { CTTransactionState, CTTransactionType } from '../../src/types/payment.types';
import { PaymentUpdateAction } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/payment';

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
            execute: jest.fn().mockRejectedValue(mockError),
          }),
        }),
      });

      await expect(createPayment(mockPaymentDraft)).rejects.toThrow(Errorx);

      expect(log.error).toHaveBeenCalledWith('Error in createPayment', mockError);
    });
  });
});
