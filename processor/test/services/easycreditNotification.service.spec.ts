import { handleEasyCreditNotification, settleOpenRefunds } from '../../src/services/easycreditNotification.service';
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
  getOpenRefundTransactions,
  getPendingCaptureTransactions,
  getSuccessCaptureTransactions,
  getSuccessTransaction,
} from '../../src/utils/payment.utils';
import { CTTransactionState, CTTransactionType } from '../../src/types/payment.types';
import { mapPendingChargeTransaction, mapUpdateActionForRefunds } from '../../src/utils/map.utils';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Errorx } from '@commercetools/connect-payments-sdk';

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
  validateInitialRefundTransaction: jest.fn(),
  validateECTransactionId: jest.fn(),
}));
jest.mock('../../src/utils/map.utils');
jest.mock('../../src/utils/config.utils', () => ({
  getPaymentTypeConfig:
    jest.requireActual<typeof import('../../src/utils/config.utils')>('../../src/utils/config.utils')
      .getPaymentTypeConfig,
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
// The booking result logic stays real; the other helpers are set per test.
jest.mock('../../src/utils/payment.utils', () => ({
  ...jest.createMockFromModule<typeof import('../../src/utils/payment.utils')>('../../src/utils/payment.utils'),
  getCaptureResult: jest.requireActual<typeof import('../../src/utils/payment.utils')>('../../src/utils/payment.utils')
    .getCaptureResult,
  getOpenRefundTransactions: jest.fn(() => []),
}));

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
            amount: { centAmount: 1200, currencyCode: 'EUR', fractionDigits: 2 },
          },
          {
            id: 'transaction2',
            type: CTTransactionType.Refund,
            state: CTTransactionState.Pending,
            amount: { centAmount: 1200, currencyCode: 'EUR', fractionDigits: 2 },
          },
          {
            id: 'transaction3',
            type: CTTransactionType.Refund,
            state: CTTransactionState.Pending,
            amount: { centAmount: 1200, currencyCode: 'EUR', fractionDigits: 2 },
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
        mockECMerchantTransaction.bookings?.[0],
        mockECMerchantTransaction.bookings?.[3],
      ]);

      // @ts-expect-error mocked
      (getPaymentByEasyCreditRefundBookingId as jest.Mock).mockResolvedValue(mockPayment);

      (getOpenRefundTransactions as jest.Mock).mockReturnValue(mockPayment.transactions);

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

    it('should not look up a payment for refunds when no completed refund has a booking ID', async () => {
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
          },
        ],
        orderDetails: { orderId: 'payment123' },
      } as unknown as ECGetMerchantTransactionResponse;

      (initEasyCreditClient as jest.Mock).mockReturnValue({
        // @ts-expect-error mocked
        getMerchantTransaction: jest.fn().mockResolvedValue(mockECMerchantTransaction),
      });

      (getCompletedRefunds as jest.Mock).mockReturnValue([
        mockECMerchantTransaction.bookings?.[0], // This has no bookingId
      ]);
      (getCaptureBooking as jest.Mock).mockReturnValue([]);

      await handleEasyCreditNotification('payment123');

      expect(getPaymentByEasyCreditRefundBookingId).not.toHaveBeenCalled();
      expect(getPaymentById).not.toHaveBeenCalled();
      expect(updatePayment).not.toHaveBeenCalled();
    });

    it('should ignore a transaction that easyCredit sends without bookings', async () => {
      (initEasyCreditClient as jest.Mock).mockReturnValue({
        // @ts-expect-error mocked
        getMerchantTransaction: jest.fn().mockResolvedValue({ orderDetails: { orderId: 'payment123' } }),
      });

      await expect(handleEasyCreditNotification('ABC123')).resolves.toBeUndefined();

      expect(getPaymentByEasyCreditRefundBookingId).not.toHaveBeenCalled();
      expect(getPaymentById).not.toHaveBeenCalled();
      expect(updatePayment).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledWith('EasyCredit sent the transaction without bookings, notification ignored', {
        resourceId: 'ABC123',
      });
    });

    it('should not update the payment when no refund transaction is open', async () => {
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

      (getCompletedRefunds as jest.Mock).mockReturnValue([mockECMerchantTransaction.bookings?.[0]]);

      // @ts-expect-error mocked
      (getPaymentByEasyCreditRefundBookingId as jest.Mock).mockResolvedValue(mockPayment);

      (getOpenRefundTransactions as jest.Mock).mockReturnValue([]); // Empty array - no pending transactions

      const resourceId = 'payment123';

      await handleEasyCreditNotification(resourceId);

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
      (getCaptureBooking as jest.Mock).mockReturnValue([mockECMerchantTransaction.bookings?.[0]]);
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
      expect(log.info).toHaveBeenCalledWith(
        'EasyCredit payment captured successfully, CommerceTools transaction state updated to Success.',
        {
          transactionId: 'capture-transaction1',
          paymentId: 'payment123',
        },
      );
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
      (getCaptureBooking as jest.Mock).mockReturnValue([mockECMerchantTransaction.bookings?.[0]]);

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

      // Without completed refund or capture bookings there is nothing to look up, also for an unknown order ID.
      expect(getPaymentById).not.toHaveBeenCalled();
      expect(updatePayment).not.toHaveBeenCalled();
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
      (getCaptureBooking as jest.Mock).mockReturnValue([mockECMerchantTransaction.bookings?.[0]]);
      // @ts-expect-error mocked
      (getPaymentById as jest.Mock).mockResolvedValue(mockPayment);
      (getPendingCaptureTransactions as jest.Mock).mockReturnValue([]); // No pending captures

      const resourceId = 'test-resource-id';

      await handleEasyCreditNotification(resourceId);

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
      (getCaptureBooking as jest.Mock).mockReturnValue([mockECMerchantTransaction.bookings?.[0]]);
      // @ts-expect-error mocked
      (getPaymentById as jest.Mock).mockResolvedValue(mockPayment);
      (getPendingCaptureTransactions as jest.Mock).mockReturnValue(mockPayment.transactions);

      const resourceId = 'test-resource-id';

      await handleEasyCreditNotification(resourceId);

      expect(log.error).toHaveBeenCalledWith('Interaction ID mismatch for capture transaction.', {
        expected: 'test-resource-id',
        actual: 'different-resource-id',
      });
      expect(updatePayment).not.toHaveBeenCalled();
    });
  });
});

describe.each(['INSTALLMENT_PAYMENT', 'BILL_PAYMENT'])('capture notification result (%s)', (method) => {
  const pendingCapture = {
    id: 'capture-transaction1',
    type: CTTransactionType.Charge,
    state: CTTransactionState.Pending,
    interactionId: 'ABC123',
  };
  const payment = {
    id: 'payment123',
    paymentMethodInfo: { paymentInterface: 'easycredit', method },
    transactions: [pendingCapture],
  };
  const booking = (status: string) => ({ bookingType: 'ApiBooking', type: 'CAPTURE', status });

  const notify = async (bookings: object[], pending: object[]) => {
    (initEasyCreditClient as jest.Mock).mockReturnValue({
      // @ts-expect-error mocked
      getMerchantTransaction: jest.fn().mockResolvedValue({ orderDetails: { orderId: 'payment123' }, bookings }),
    });
    (getCompletedRefunds as jest.Mock).mockReturnValue([]);
    (getCaptureBooking as jest.Mock).mockReturnValue(bookings);
    // @ts-expect-error mocked
    (getPaymentById as jest.Mock).mockResolvedValue(payment);
    (getPendingCaptureTransactions as jest.Mock).mockReturnValue(pending);

    await handleEasyCreditNotification('ABC123');
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets the pending Charge to Failure for a FAILED capture booking and logs the reason', async () => {
    await notify(
      [{ ...booking('FAILED'), message: { messageDE: 'Fehler', messageEN: 'Capture not possible' } }],
      [pendingCapture],
    );

    expect(updatePayment).toHaveBeenCalledWith(payment, [
      { action: 'changeTransactionState', transactionId: 'capture-transaction1', state: CTTransactionState.Failure },
    ]);
    expect(log.error).toHaveBeenCalledWith(
      'EasyCredit capture failed, CommerceTools transaction state updated to Failure.',
      { transactionId: 'capture-transaction1', paymentId: 'payment123', reason: 'Capture not possible' },
    );
  });

  it('sets the pending Charge to Success when a retried capture is DONE after a FAILED one', async () => {
    await notify([booking('FAILED'), booking('DONE')], [pendingCapture]);

    expect(updatePayment).toHaveBeenCalledWith(payment, [
      { action: 'changeTransactionState', transactionId: 'capture-transaction1', state: CTTransactionState.Success },
    ]);
  });

  it('adds the Charge from the Authorization for a DONE booking without pending Charge', async () => {
    const authorization = { id: 'auth-1', type: CTTransactionType.Authorization, state: CTTransactionState.Success };
    const draft = { type: CTTransactionType.Charge, state: CTTransactionState.Pending };
    (getSuccessTransaction as jest.Mock).mockReturnValue(authorization);
    (mapPendingChargeTransaction as jest.Mock).mockReturnValue(draft);
    // @ts-expect-error mocked
    (updatePayment as jest.Mock).mockResolvedValue(payment);
    (getPendingCaptureTransactions as jest.Mock).mockReturnValueOnce([]).mockReturnValueOnce([pendingCapture]);

    await notify([booking('DONE')], []);

    expect(mapPendingChargeTransaction).toHaveBeenCalledWith(authorization);
    expect(updatePayment).toHaveBeenNthCalledWith(1, payment, [{ action: 'addTransaction', transaction: draft }]);
    expect(updatePayment).toHaveBeenNthCalledWith(2, payment, [
      { action: 'changeTransactionState', transactionId: 'capture-transaction1', state: CTTransactionState.Success },
    ]);
  });

  it('keeps the retried Charge Pending while its booking is pending after an earlier FAILED one', async () => {
    await notify(
      [
        { ...booking('FAILED'), created: '2026-10-28T04:00:00+01:00' },
        { ...booking('PENDING'), created: '2026-10-28T05:00:00+01:00' },
      ],
      [pendingCapture],
    );

    expect(updatePayment).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith('EasyCredit capture is still being processed', { paymentId: 'payment123' });
  });

  describe('for a retried capture', () => {
    const earlier = { ...booking('FAILED'), uuid: 'capture-earlier', created: '2026-10-28T05:50:00+01:00' };
    const retried = {
      ...pendingCapture,
      timestamp: '2026-10-28T05:00:00.000Z',
      custom: { fields: { easyCreditEarlierCaptureBookings: [earlier.uuid] } },
    };

    it('keeps the Charge Pending while easyCredit lists only the FAILED booking of the earlier capture', async () => {
      // Dated after the Charge, which only an easyCredit clock running ahead explains.
      await notify([earlier], [retried]);

      expect(updatePayment).not.toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledWith('EasyCredit capture is still being processed', {
        paymentId: 'payment123',
      });
    });

    it('sets the Charge to Failure for its own FAILED booking, whatever its date', async () => {
      await notify(
        [earlier, { ...booking('FAILED'), uuid: 'capture-own', created: '2026-10-28T04:00:00+01:00' }],
        [retried],
      );

      expect(updatePayment).toHaveBeenCalledWith(payment, [
        { action: 'changeTransactionState', transactionId: 'capture-transaction1', state: CTTransactionState.Failure },
      ]);
    });
  });

  it('changes nothing when a Charge is already Success', async () => {
    (getSuccessCaptureTransactions as jest.Mock).mockReturnValue([{ id: 'charge-done' }]);

    await notify([booking('DONE')], []);

    expect(updatePayment).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith('Capture transaction already marked as Success, no further action needed.', {
      paymentId: 'payment123',
      transactionId: 'charge-done',
    });
    (getSuccessCaptureTransactions as jest.Mock).mockReset();
  });

  it('adds no Charge for a FAILED capture booking without pending Charge', async () => {
    await notify([booking('FAILED')], []);

    expect(updatePayment).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      'Failed EasyCredit capture without pending capture transaction, nothing to update.',
      { paymentId: 'payment123' },
    );
  });
});

describe('refund notification result', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs the easyCredit reason of a FAILED refund booking', async () => {
    const failed = {
      bookingType: 'RefundBooking',
      type: 'REFUND',
      status: 'FAILED',
      bookingId: 'refund-1',
      message: {
        messageDE: 'Der Rückabwicklungsbetrag ist für diese Transaktion zu hoch.',
        messageEN: 'The Refund amount is too high for this transaction.',
      },
    };
    const payment = { id: 'payment123', transactions: [{ id: 'refund-1', type: 'Refund', state: 'Pending' }] };
    (initEasyCreditClient as jest.Mock).mockReturnValue({
      // @ts-expect-error mocked
      getMerchantTransaction: jest.fn().mockResolvedValue({ bookings: [failed] }),
    });
    (getCompletedRefunds as jest.Mock).mockReturnValue([failed]);
    // @ts-expect-error mocked
    (getPaymentByEasyCreditRefundBookingId as jest.Mock).mockResolvedValue(payment);
    (getOpenRefundTransactions as jest.Mock).mockReturnValue(payment.transactions);
    (mapUpdateActionForRefunds as jest.Mock).mockReturnValue([
      { action: 'changeTransactionState', transactionId: 'refund-1', state: CTTransactionState.Failure },
    ]);

    await handleEasyCreditNotification('ABC123');

    expect(log.warn).toHaveBeenCalledWith(
      'EasyCredit refund failed, CommerceTools transaction state updated to Failure.',
      {
        paymentId: 'payment123',
        transactionId: 'refund-1',
        reason: 'The Refund amount is too high for this transaction.',
      },
    );
  });

  it('still completes the capture and passes the error on when the refund lookup fails', async () => {
    const refund = { bookingType: 'RefundBooking', type: 'REFUND', status: 'DONE', bookingId: 'refund-1' };
    const capture = { bookingType: 'ApiBooking', type: 'CAPTURE', status: 'DONE' };
    const pendingCapture = {
      id: 'capture-transaction1',
      type: CTTransactionType.Charge,
      state: CTTransactionState.Pending,
      interactionId: 'ABC123',
    };
    const payment = { id: 'payment123', transactions: [pendingCapture] };
    const notFound = new Errorx({ code: 'ResourceNotFound', message: 'Payment not found', httpErrorStatus: 404 });
    (initEasyCreditClient as jest.Mock).mockReturnValue({
      getMerchantTransaction: jest
        .fn()
        // @ts-expect-error mocked
        .mockResolvedValue({ orderDetails: { orderId: 'payment123' }, bookings: [refund, capture] }),
    });
    (getCompletedRefunds as jest.Mock).mockReturnValue([refund]);
    // @ts-expect-error mocked
    (getPaymentByEasyCreditRefundBookingId as jest.Mock).mockRejectedValue(notFound);
    (getCaptureBooking as jest.Mock).mockReturnValue([capture]);
    // @ts-expect-error mocked
    (getPaymentById as jest.Mock).mockResolvedValue(payment);
    (getPendingCaptureTransactions as jest.Mock).mockReturnValue([pendingCapture]);

    await expect(handleEasyCreditNotification('ABC123')).rejects.toBe(notFound);

    expect(updatePayment).toHaveBeenCalledWith(payment, [
      { action: 'changeTransactionState', transactionId: 'capture-transaction1', state: CTTransactionState.Success },
    ]);
  });
});

describe('settleOpenRefunds', () => {
  const refund = (id: string, state: CTTransactionState) => ({
    id,
    type: CTTransactionType.Refund,
    state,
    amount: { centAmount: 1000, currencyCode: 'EUR', fractionDigits: 2 },
  });
  const refundBooking = (bookingId: string, status: string) => ({
    bookingType: 'RefundBooking',
    type: 'REFUND',
    status,
    bookingId,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (getCompletedRefunds as jest.Mock).mockReturnValue([]);
    (mapUpdateActionForRefunds as jest.Mock).mockReturnValue([]);
  });

  it('warns about open refunds that easyCredit has no booking for', async () => {
    const open = [refund('refund-lost', CTTransactionState.Initial), refund('refund-sent', CTTransactionState.Pending)];
    const payment = { id: 'payment123', transactions: open };
    (getOpenRefundTransactions as jest.Mock).mockReturnValue(open);

    // @ts-expect-error partial payment
    await settleOpenRefunds(payment, [refundBooking('refund-sent', 'PENDING')]);

    expect(log.warn).toHaveBeenCalledWith('Refunds without an easyCredit booking stay open and keep their amount', {
      paymentId: 'payment123',
      refunds: [
        { transactionId: 'refund-lost', state: 'Initial', centAmount: 1000, ecBookingStatus: 'none' },
        { transactionId: 'refund-sent', state: 'Pending', centAmount: 1000, ecBookingStatus: 'PENDING' },
      ],
    });
  });

  it('logs open refunds with a booking in progress as info only', async () => {
    const open = [refund('refund-sent', CTTransactionState.Pending), refund('refund-done', CTTransactionState.Pending)];
    (getOpenRefundTransactions as jest.Mock).mockReturnValue(open);

    // @ts-expect-error partial payment
    await settleOpenRefunds({ id: 'payment123', transactions: open }, [
      refundBooking('refund-sent', 'PENDING'),
      refundBooking('refund-done', 'DONE'),
    ]);

    expect(log.warn).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith('Refunds stay open while their easyCredit booking is processed', {
      paymentId: 'payment123',
      refunds: [{ transactionId: 'refund-sent', state: 'Pending', centAmount: 1000, ecBookingStatus: 'PENDING' }],
    });
  });
});
