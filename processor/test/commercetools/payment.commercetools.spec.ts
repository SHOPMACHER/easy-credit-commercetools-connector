import { Errorx } from '@commercetools/connect-payments-sdk';
import { createApiRoot } from '../../src/client/create.client';
import { log } from '../../src/libs/logger';
import { initEasyCreditClient } from "../../src/client/easycredit.client";
import { getPaymentById, updatePaymentStatus } from '../../src/commercetools/payment.commercetools';

// Mock the dependent functions
jest.mock('../../src/client/create.client');
jest.mock('../../src/libs/logger');
jest.mock('../../src/client/easycredit.client');

describe('getPaymentById', () => {
  const paymentId = 'sample-payment-id';

  it('should return payment object when successful', async () => {
    const mockPaymentObject = { id: paymentId, version: 1 };
    const mockResponse = { body: mockPaymentObject };

    // Mock createApiRoot and the response returned from the API
    (createApiRoot as jest.Mock).mockReturnValue({
      payments: () => ({
        withId: () => ({
          get: () => ({
            execute: jest.fn().mockResolvedValue(mockResponse),
          }),
        }),
      }),
    });

    const result = await getPaymentById(paymentId);

    expect(result).toEqual(mockPaymentObject);
    expect(createApiRoot).toHaveBeenCalled();
  });

  it('should log error and throw Errorx when an error occurs', async () => {
    const mockError = {
      code: '404',
      body: { message: 'Not Found', errors: [] },
      statusCode: 404,
    };

    // Mock the error returned from the API
    (createApiRoot as jest.Mock).mockReturnValue({
      payments: () => ({
        withId: () => ({
          get: () => ({
            execute: jest.fn().mockRejectedValue(mockError),
          }),
        }),
      }),
    });

    await expect(getPaymentById(paymentId)).rejects.toThrow(Errorx);

    expect(log.error).toHaveBeenCalledWith('Error in getting CommerceTools Payment', mockError);
  });
});

describe('updatePaymentStatus', () => {
  const paymentId = 'sample-payment-id';
  const newStatus = 'Cancelled';

  beforeEach(() => {
    jest.clearAllMocks(); // Ensure all mocks are cleared between tests
  });

  it('should update the payment status successfully when all conditions are met', async () => {
    const mockPayment = {
      id: paymentId,
      version: 1,
      paymentMethodInfo: { paymentInterface: 'easycredit' },
      transactions: [
        { id: 'transaction-1', type: 'Authorization', state: 'Initial', interactionId: 'interaction-1' },
      ],
    };
    const mockEasyTransaction = { status: 'DECLINED' };
    const mockResponse = { body: { success: true } };

    jest.spyOn(require('../../src/commercetools/payment.commercetools'), 'getPaymentById').mockResolvedValue(mockPayment);

    (initEasyCreditClient as jest.Mock).mockReturnValue({
      getPayment: jest.fn().mockResolvedValue(mockEasyTransaction),
    });
    (createApiRoot as jest.Mock).mockReturnValue({
      payments: () => ({
        withId: () => ({
          post: () => ({
            execute: jest.fn().mockResolvedValue(mockResponse),
          }),
        }),
      }),
    });

    const result = await updatePaymentStatus(paymentId, newStatus);

    expect(result).toEqual(mockResponse.body);
    expect(initEasyCreditClient().getPayment).toHaveBeenCalledWith('interaction-1');
    expect(createApiRoot).toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(`Payment ${paymentId} cancelled successfully.`);
  });

  it('should throw an error when no Authorization transaction in Initial state is found', async () => {
    const mockPayment = {
      id: paymentId,
      version: 1,
      paymentMethodInfo: { paymentInterface: 'easycredit' },
      transactions: [],
    };

    jest.spyOn(require('../../src/commercetools/payment.commercetools'), 'getPaymentById').mockResolvedValue(mockPayment);

    await expect(updatePaymentStatus(paymentId, newStatus)).rejects.toThrow(Errorx);
    expect(log.error).toHaveBeenCalled();
  });

  it('should throw an error when EasyCredit transaction is not declined', async () => {
    const mockPayment = {
      id: paymentId,
      version: 1,
      paymentMethodInfo: { paymentInterface: 'easycredit' },
      transactions: [
        { id: 'transaction-1', type: 'Authorization', state: 'Initial', interactionId: 'interaction-1' },
      ],
    };
    const mockEasyTransaction = { status: 'APPROVED' };

    jest.spyOn(require('../../src/commercetools/payment.commercetools'), 'getPaymentById').mockResolvedValue(mockPayment);

    (initEasyCreditClient as jest.Mock).mockReturnValue({
      getPayment: jest.fn().mockResolvedValue(mockEasyTransaction),
    });

    await expect(updatePaymentStatus(paymentId, newStatus)).rejects.toThrow(Errorx);
    expect(log.error).toHaveBeenCalled();
  });

  it('should throw an error if payment method is not EasyCredit', async () => {
    const mockPayment = {
      id: paymentId,
      version: 1,
      paymentMethodInfo: { paymentInterface: 'not-easycredit' },
      transactions: [
        { id: 'transaction-1', type: 'Authorization', state: 'Initial', interactionId: 'interaction-1' },
      ],
    };

    jest.spyOn(require('../../src/commercetools/payment.commercetools'), 'getPaymentById').mockResolvedValue(mockPayment);

    await expect(updatePaymentStatus(paymentId, newStatus)).rejects.toThrow(Errorx);
    expect(log.error).toHaveBeenCalledWith('Error in updating CommerceTools Payment status', expect.anything());
  });
});

