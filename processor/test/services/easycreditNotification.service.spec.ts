import { handleEasyCreditNotification } from '../../src/services/easycreditNotification.service';
import { ECGetMerchantTransactionResponse } from '../../src/types/payment.types';
import {
  getPaymentByEasyCreditRefundBookingId,
  getPaymentById,
  updatePayment,
} from '../../src/commercetools/payment.commercetools';
import { initEasyCreditClient } from '../../src/client/easycredit.client';
import { log } from '../../src/libs/logger';
import {
  getCaptureBooking,
  getCompletedRefunds,
  getPendingCaptureTransactions,
  getPendingRefundTransactions,
} from '../../src/utils/payment.utils';
import { CTTransactionState, CTTransactionType } from '../../src/types/payment.types';
import { mapUpdateActionForRefunds } from '../../src/utils/map.utils';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

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
  validateECTransactionId: jest.fn(),
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

    it('should log error when completed refunds have no booking ID', async () => {
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
            // bookingId is missing - this should trigger the error
          },
        ],
      } as unknown as ECGetMerchantTransactionResponse;

      (initEasyCreditClient as jest.Mock).mockReturnValue({
        // @ts-expect-error mocked
        getMerchantTransaction: jest.fn().mockResolvedValue(mockECMerchantTransaction),
      });

      (getCompletedRefunds as jest.Mock).mockReturnValue([
        mockECMerchantTransaction.bookings[0], // This has no bookingId
      ]);

      const resourceId = 'payment123';

      await handleEasyCreditNotification(resourceId);

      expect(log.error).toHaveBeenCalledWith('No booking ID found for completed refund');
      expect(getPaymentByEasyCreditRefundBookingId).not.toHaveBeenCalled();
    });

    it('should log error when no pending refund transactions exist', async () => {
      const mockPayment = {
        id: 'payment123',
        transactions: [], // No transactions
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
        ],
      } as unknown as ECGetMerchantTransactionResponse;

      (initEasyCreditClient as jest.Mock).mockReturnValue({
        // @ts-expect-error mocked
        getMerchantTransaction: jest.fn().mockResolvedValue(mockECMerchantTransaction),
      });

      (getCompletedRefunds as jest.Mock).mockReturnValue([mockECMerchantTransaction.bookings[0]]);

      // @ts-expect-error mocked
      (getPaymentByEasyCreditRefundBookingId as jest.Mock).mockResolvedValue(mockPayment);

      (getPendingRefundTransactions as jest.Mock).mockReturnValue([]); // Empty array - no pending transactions

      const resourceId = 'payment123';

      await handleEasyCreditNotification(resourceId);

      expect(log.error).toHaveBeenCalledWith('No pending refund transactions to update');
      expect(mapUpdateActionForRefunds).not.toHaveBeenCalled();
      expect(updatePayment).not.toHaveBeenCalled();
    });

    it('should handle the case when no completed refunds exist', async () => {
      const mockECMerchantTransaction = {
        bookings: [
          {
            bookingType: 'RefundBooking',
            uuid: 'b6731d8c-27d0-4a82-ac35-5d19c0a1f5c8',
            created: '2024-10-29T10:08:35+01:00',
            type: 'REFUND',
            status: 'PENDING', // Not completed
            message: null,
            amount: 12.0,
            bookingId: 'transaction1',
          },
        ],
      } as unknown as ECGetMerchantTransactionResponse;

      (initEasyCreditClient as jest.Mock).mockReturnValue({
        // @ts-expect-error mocked
        getMerchantTransaction: jest.fn().mockResolvedValue(mockECMerchantTransaction),
      });

      (getCompletedRefunds as jest.Mock).mockReturnValue([]); // No completed refunds

      const resourceId = 'payment123';

      await handleEasyCreditNotification(resourceId);

      expect(getPaymentByEasyCreditRefundBookingId).not.toHaveBeenCalled();
      expect(log.error).not.toHaveBeenCalled();
    });

    it('should handle capture notifications successfully', async () => {
      const mockPayment = {
        id: 'payment123',
        transactions: [
          {
            id: 'capture-transaction1',
            type: CTTransactionType.Charge,
            state: CTTransactionState.Pending,
            interactionId: 'test-resource-id',
          },
        ],
      };

      const mockECMerchantTransaction = {
        orderDetails: {
          orderId: 'payment123', // Maps to CommerceTools payment ID
        },
        bookings: [
          {
            bookingType: 'CaptureBooking',
            uuid: 'capture-uuid-1',
            created: '2024-10-29T10:08:35+01:00',
            type: 'CAPTURE',
            status: 'DONE',
            message: null,
            amount: 100.0,
          },
        ],
      } as unknown as ECGetMerchantTransactionResponse;

      (initEasyCreditClient as jest.Mock).mockReturnValue({
        // @ts-expect-error mocked
        getMerchantTransaction: jest.fn().mockResolvedValue(mockECMerchantTransaction),
      });

      (getCompletedRefunds as jest.Mock).mockReturnValue([]); // No refunds to process
      (getCaptureBooking as jest.Mock).mockReturnValue([mockECMerchantTransaction.bookings[0]]);
      // @ts-expect-error mocked
      (getPaymentById as jest.Mock).mockResolvedValue(mockPayment);
      (getPendingCaptureTransactions as jest.Mock).mockReturnValue(mockPayment.transactions);

      const resourceId = 'test-resource-id';

      await handleEasyCreditNotification(resourceId);

      expect(getPaymentById).toHaveBeenCalledWith('payment123');
      expect(updatePayment).toHaveBeenCalledWith(mockPayment, [
        {
          action: 'changeTransactionState',
          transactionId: 'capture-transaction1',
          state: CTTransactionState.Success,
        },
      ]);
      expect(log.info).toHaveBeenCalledWith('EC successfully capture payment, move CT transaction state to Success.', {
        transactionId: 'capture-transaction1',
        paymentId: 'payment123',
      });
    });

    it('should log warning when no payment ID found in EC transaction order details', async () => {
      const mockECMerchantTransaction = {
        orderDetails: {}, // Missing orderId
        bookings: [
          {
            bookingType: 'CaptureBooking',
            uuid: 'capture-uuid-1',
            type: 'CAPTURE',
            status: 'DONE',
          },
        ],
      } as unknown as ECGetMerchantTransactionResponse;

      (initEasyCreditClient as jest.Mock).mockReturnValue({
        // @ts-expect-error mocked
        getMerchantTransaction: jest.fn().mockResolvedValue(mockECMerchantTransaction),
      });

      (getCompletedRefunds as jest.Mock).mockReturnValue([]);
      (getCaptureBooking as jest.Mock).mockReturnValue([mockECMerchantTransaction.bookings[0]]);

      const resourceId = 'test-resource-id';

      await handleEasyCreditNotification(resourceId);

      expect(log.warn).toHaveBeenCalledWith('No payment ID found in EC transaction order details');
      expect(getPaymentById).not.toHaveBeenCalled();
    });

    it('should handle case when no capture bookings exist', async () => {
      const mockECMerchantTransaction = {
        orderDetails: {
          orderId: 'payment123',
        },
        bookings: [], // No capture bookings
      } as unknown as ECGetMerchantTransactionResponse;

      (initEasyCreditClient as jest.Mock).mockReturnValue({
        // @ts-expect-error mocked
        getMerchantTransaction: jest.fn().mockResolvedValue(mockECMerchantTransaction),
      });

      (getCompletedRefunds as jest.Mock).mockReturnValue([]);
      (getCaptureBooking as jest.Mock).mockReturnValue([]); // No capture bookings

      const resourceId = 'test-resource-id';

      await handleEasyCreditNotification(resourceId);

      expect(getPaymentById).not.toHaveBeenCalled();
      expect(log.warn).not.toHaveBeenCalled();
    });

    it('should log info when no pending capture transactions exist', async () => {
      const mockPayment = {
        id: 'payment123',
        transactions: [], // No pending transactions
      };

      const mockECMerchantTransaction = {
        orderDetails: {
          orderId: 'payment123',
        },
        bookings: [
          {
            bookingType: 'CaptureBooking',
            uuid: 'capture-uuid-1',
            type: 'CAPTURE',
            status: 'DONE',
          },
        ],
      } as unknown as ECGetMerchantTransactionResponse;

      (initEasyCreditClient as jest.Mock).mockReturnValue({
        // @ts-expect-error mocked
        getMerchantTransaction: jest.fn().mockResolvedValue(mockECMerchantTransaction),
      });

      (getCompletedRefunds as jest.Mock).mockReturnValue([]);
      (getCaptureBooking as jest.Mock).mockReturnValue([mockECMerchantTransaction.bookings[0]]);
      // @ts-expect-error mocked
      (getPaymentById as jest.Mock).mockResolvedValue(mockPayment);
      (getPendingCaptureTransactions as jest.Mock).mockReturnValue([]); // No pending captures

      const resourceId = 'test-resource-id';

      await handleEasyCreditNotification(resourceId);

      expect(log.info).toHaveBeenCalledWith('No pending capture transactions to update');
      expect(updatePayment).not.toHaveBeenCalled();
    });

    it('should log warning when interaction ID mismatch for capture transaction', async () => {
      const mockPayment = {
        id: 'payment123',
        transactions: [
          {
            id: 'capture-transaction1',
            type: CTTransactionType.Charge,
            state: CTTransactionState.Pending,
            interactionId: 'different-resource-id', // Mismatch
          },
        ],
      };

      const mockECMerchantTransaction = {
        orderDetails: {
          orderId: 'payment123',
        },
        bookings: [
          {
            bookingType: 'CaptureBooking',
            uuid: 'capture-uuid-1',
            type: 'CAPTURE',
            status: 'DONE',
          },
        ],
      } as unknown as ECGetMerchantTransactionResponse;

      (initEasyCreditClient as jest.Mock).mockReturnValue({
        // @ts-expect-error mocked
        getMerchantTransaction: jest.fn().mockResolvedValue(mockECMerchantTransaction),
      });

      (getCompletedRefunds as jest.Mock).mockReturnValue([]);
      (getCaptureBooking as jest.Mock).mockReturnValue([mockECMerchantTransaction.bookings[0]]);
      // @ts-expect-error mocked
      (getPaymentById as jest.Mock).mockResolvedValue(mockPayment);
      (getPendingCaptureTransactions as jest.Mock).mockReturnValue(mockPayment.transactions);

      const resourceId = 'test-resource-id';

      await handleEasyCreditNotification(resourceId);

      expect(log.warn).toHaveBeenCalledWith('Interaction ID mismatch for capture transaction.', {
        expected: 'test-resource-id',
        actual: 'different-resource-id',
      });
      expect(updatePayment).not.toHaveBeenCalled();
    });
  });
});
