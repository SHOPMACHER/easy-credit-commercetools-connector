import { handleEasyCreditNotification } from './../../src/services/easycreditNotification.service';
import { ECGetMerchantTransactionResponse } from './../../src/types/payment.types';
import { updatePayment, getPaymentByEasyCreditRefundBookingId } from '../../src/commercetools/payment.commercetools';
import { initEasyCreditClient } from '../../src/client/easycredit.client';
import { log } from '../../src/libs/logger';
import { getCompletedRefunds, getPendingRefundTransactions } from '../../src/utils/payment.utils';
import { CTTransactionState, CTTransactionType } from '../../src/types/payment.types';
import { mapUpdateActionForRefunds } from '../../src/utils/map.utils';
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

describe('Easycredit Notification handlers', () => {
  describe('handleEasyCreditNotification', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should handle the notification successfully', async () => {
      const mockPayment = {
        id: 'payment123',
        transactions: [
          {
            id: 'transaction1',
            type: CTTransactionType.Refund,
            state: CTTransactionState.Pending,
          },
          {
            id: 'transaction2',
            type: CTTransactionType.Refund,
            state: CTTransactionState.Pending,
          },
          {
            id: 'transaction3',
            type: CTTransactionType.Refund,
            state: CTTransactionState.Pending,
          },
        ],
      };

      const mockECMerchantTransaction = {
        bookings: [
          {
            bookingType: 'RefundBooking',
            uuid: 'b6731d8c-27d0-4a82-ac35-5d19c0a1f5c8',
            created: '2024-10-29T10:08:35+01:00',
            type: 'REFUND',
            status: 'DONE',
            message: null,
            amount: 12.0,
            bookingId: 'transaction1',
          },
          {
            bookingType: 'ApiBooking',
            uuid: '4799d92d-e8e2-4d79-9608-9b6d3b0c7dec',
            created: '2024-10-29T10:09:00+01:00',
            type: 'NOTIFY',
            status: 'DONE',
            message: null,
          },
          {
            bookingType: 'RefundBooking',
            uuid: '00a7da4d-fae1-4013-9f23-a103485c358d',
            created: '2024-10-29T10:12:28+01:00',
            type: 'REFUND',
            status: 'PENDING',
            message: null,
            amount: 3.0,
            bookingId: 'transaction2',
          },
          {
            bookingType: 'RefundBooking',
            uuid: 'd0ed5b26-8fe8-4b9a-a4a4-476b0c530c36',
            created: '2024-10-29T11:43:12+01:00',
            type: 'REFUND',
            status: 'DONE',
            message: null,
            amount: 3.0,
            bookingId: 'transaction3',
          },
        ],
      } as unknown as ECGetMerchantTransactionResponse;

      (initEasyCreditClient as jest.Mock).mockReturnValue({
        // @ts-expect-error mocked
        getMerchantTransaction: jest.fn().mockResolvedValue(mockECMerchantTransaction),
      });

      (getCompletedRefunds as jest.Mock).mockReturnValue([
        mockECMerchantTransaction.bookings[0],
        mockECMerchantTransaction.bookings[3],
      ]);

      // @ts-expect-error mocked
      (getPaymentByEasyCreditRefundBookingId as jest.Mock).mockResolvedValue(mockPayment);

      (getPendingRefundTransactions as jest.Mock).mockReturnValue(mockPayment.transactions);

      const updateActions = [
        {
          action: 'ChangeTransactionState',
          id: mockPayment.transactions[0],
          state: CTTransactionState.Success,
        },
        {
          action: 'ChangeTransactionState',
          id: mockPayment.transactions[3],
          state: CTTransactionState.Success,
        },
      ];

      (mapUpdateActionForRefunds as jest.Mock).mockReturnValueOnce(updateActions);

      const resourceId = 'payment123';

      await handleEasyCreditNotification(resourceId);

      expect(initEasyCreditClient().getMerchantTransaction).toHaveBeenCalledWith(resourceId);
      expect(updatePayment).toHaveBeenCalledTimes(1);
      expect(updatePayment).toHaveBeenCalledWith(mockPayment, updateActions);
    });

    it('should throw and log error', async () => {
      const mockError = new Error('get transaction failed');
      (initEasyCreditClient as jest.Mock).mockReturnValue({
        // @ts-expect-error mocked
        getMerchantTransaction: jest.fn().mockRejectedValue(mockError),
      });

      const resourceId = 'payment123';

      await expect(handleEasyCreditNotification(resourceId)).rejects.toThrow('get transaction failed');
      expect(log.error).toHaveBeenCalledWith('Error in handling EasyCredit notification', mockError);
    });
  });
});
