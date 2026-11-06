import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Errorx } from '@commercetools/connect-payments-sdk';
import { handleCapturePayment, handleRefundPayment } from '../../src/services/payment.service';
import { getPaymentById, updatePayment } from '../../src/commercetools/payment.commercetools';
import { initEasyCreditClient } from '../../src/client/easycredit.client';
import { log } from '../../src/libs/logger';
import { ECOutcomeUnknownError } from '../../src/client/easycredit.errors';

jest.mock('../../src/commercetools/cart.commercetools');
jest.mock('../../src/commercetools/payment.commercetools');
jest.mock('../../src/client/easycredit.client');
jest.mock('../../src/libs/logger');
jest.mock('../../src/services/webshop.service');
jest.mock('../../src/utils/config.utils', () => ({
  readConfiguration: jest.fn(() => ({
    easyCredit: { webShopId: 'webShopId123' },
    commerceTools: { projectKey: 'projectKey123', clientId: 'clientId123', clientSecret: 'clientSecret', region: 'eu' },
  })),
}));

type AnyFn = (...args: any[]) => any;
type Tx = {
  id: string;
  type: string;
  state: string;
  interactionId?: string;
  amount?: object;
  custom?: object;
  timestamp?: string;
};
const mock = (fn: unknown) => fn as jest.Mock<AnyFn>;

const PAYMENT_ID = 'payment-1';
const EC_TX_ID = 'ABC123';
const TECH_ID = 'tech-1';

const authorization: Tx = {
  id: 'auth-1',
  type: 'Authorization',
  state: 'Success',
  interactionId: EC_TX_ID,
  amount: { centAmount: 10000, currencyCode: 'EUR', fractionDigits: 2 },
  custom: { fields: { easyCreditTechnicalTransactionId: TECH_ID } },
};

const buildPayment = (method: string | undefined, extra: Tx[] = []) => ({
  id: PAYMENT_ID,
  version: 3,
  amountPlanned: { centAmount: 10000, currencyCode: 'EUR', fractionDigits: 2 },
  paymentMethodInfo: { paymentInterface: 'easycredit', method },
  transactions: [authorization, ...extra],
});

const ecError = new Errorx({ code: 'Booking not allowed', message: 'Booking not allowed', httpErrorStatus: 400 });
const alreadyCapturedError = new Errorx({
  code: 'CAPTURE already submitted',
  message: 'CAPTURE already submitted',
  httpErrorStatus: 409,
});
const captureTimeoutError = new ECOutcomeUnknownError({
  code: 'CaptureFailed',
  message: 'Capture failed',
  httpErrorStatus: 504,
});
const conflictError = new Errorx({ code: 'ConcurrentModification', message: 'Version mismatch', httpErrorStatus: 409 });
const timeoutError = new ECOutcomeUnknownError({
  code: 'RefundFailed',
  message: 'Refund failed',
  httpErrorStatus: 504,
});

const cents = (centAmount: number) => ({ centAmount, currencyCode: 'EUR', fractionDigits: 2 });
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString();
const captureBooking = (status: string, created: string, message?: object) => ({
  bookingType: 'ApiBooking',
  type: 'CAPTURE',
  uuid: `booking-${status}-${created}`,
  created,
  status,
  message,
});

const client = {
  getPayment: jest.fn<AnyFn>(),
  getMerchantTransaction: jest.fn<AnyFn>(),
  capturePayment: jest.fn<AnyFn>(),
  refundPayment: jest.fn<AnyFn>(),
};

const updateActions = () => mock(updatePayment).mock.calls.map((c) => c[1] as Record<string, unknown>[]);

// CT does not specify where an added transaction lands in the array, so tests place it at either end.
const addOnUpdate = (payment: ReturnType<typeof buildPayment>, newId: string, position: 'end' | 'start' = 'end') =>
  mock(updatePayment).mockImplementation(async (current: typeof payment, actions: Record<string, any>[]) => {
    const add = actions.find((a) => a.action === 'addTransaction');
    const changes = new Map(
      actions.filter((a) => a.action === 'changeTransactionState').map((a) => [a.transactionId, a.state]),
    );
    if (changes.size > 0) {
      const transactions = current.transactions.map((t) =>
        changes.has(t.id) ? { ...t, state: changes.get(t.id) } : t,
      );
      return { ...current, transactions };
    }
    if (!add) return current;
    const added = { id: newId, ...add.transaction };
    const transactions = position === 'end' ? [...current.transactions, added] : [added, ...current.transactions];
    return { ...current, transactions };
  });

// The legacy method 'easycredit' and a missing method are treated as installment.
describe.each(['INSTALLMENT_PAYMENT', 'BILL_PAYMENT', 'easycredit', undefined])('capture and refund (%s)', (method) => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.values(client).forEach((fn) => fn.mockReset());
    mock(initEasyCreditClient).mockReturnValue(client);
    mock(updatePayment).mockImplementation(async (payment) => payment);
    client.getPayment.mockResolvedValue({ status: 'AUTHORIZED', decision: { transactionId: EC_TX_ID } });
    client.getMerchantTransaction.mockResolvedValue({
      transactionId: EC_TX_ID,
      status: 'REPORT_CAPTURE',
      bookings: [],
    });
  });

  describe('handleCapturePayment', () => {
    it('TEBA-218: adds a pending Charge, then captures at easyCredit', async () => {
      const payment = buildPayment(method);
      mock(getPaymentById).mockResolvedValue(payment);
      addOnUpdate(payment, 'charge-new');

      await handleCapturePayment(PAYMENT_ID, 'track-1');

      expect(client.getPayment).toHaveBeenCalledWith(TECH_ID, expect.any(AbortSignal));
      expect(client.capturePayment).toHaveBeenCalledWith(EC_TX_ID, PAYMENT_ID, 'track-1');
      expect(updateActions()).toEqual([
        [
          expect.objectContaining({
            action: 'addTransaction',
            transaction: expect.objectContaining({ type: 'Charge', state: 'Pending', interactionId: EC_TX_ID }),
          }),
        ],
      ]);
      // An early easyCredit notification must find the Charge.
      expect(mock(updatePayment).mock.invocationCallOrder[0]).toBeLessThan(
        client.capturePayment.mock.invocationCallOrder[0],
      );
    });

    it('does not read the easyCredit bookings for the first capture, as 1.0 did not', async () => {
      const payment = buildPayment(method);
      mock(getPaymentById).mockResolvedValue(payment);
      addOnUpdate(payment, 'charge-new');

      await handleCapturePayment(PAYMENT_ID);

      expect(client.getMerchantTransaction).not.toHaveBeenCalled();
      expect(client.capturePayment).toHaveBeenCalledTimes(1);
    });

    it('TEBA-222: still captures when a refund was registered before shipping', async () => {
      const payment = buildPayment(method, [
        { id: 'refund-1', type: 'Refund', state: 'Pending', amount: cents(1000), timestamp: minutesAgo(1) },
      ]);
      mock(getPaymentById).mockResolvedValue(payment);
      addOnUpdate(payment, 'charge-new');

      await handleCapturePayment(PAYMENT_ID);

      expect(client.capturePayment).toHaveBeenCalledTimes(1);
    });

    it('TEBA-212: sets the Charge to Failure and passes the easyCredit error on', async () => {
      const payment = buildPayment(method);
      mock(getPaymentById).mockResolvedValue(payment);
      addOnUpdate(payment, 'charge-new');
      client.capturePayment.mockRejectedValue(ecError);

      await expect(handleCapturePayment(PAYMENT_ID)).rejects.toBe(ecError);
      expect(updateActions()[1]).toEqual([
        { action: 'changeTransactionState', transactionId: 'charge-new', state: 'Failure' },
      ]);
    });

    it('keeps the easyCredit error when marking the Charge as failed fails too', async () => {
      const payment = buildPayment(method);
      mock(getPaymentById).mockResolvedValue(payment);
      mock(updatePayment)
        .mockImplementationOnce(async (current: typeof payment) => ({
          ...current,
          transactions: [...current.transactions, { id: 'charge-new', type: 'Charge', state: 'Pending' }],
        }))
        .mockRejectedValueOnce(new Error('ConcurrentModification'));
      client.capturePayment.mockRejectedValue(ecError);

      await expect(handleCapturePayment(PAYMENT_ID)).rejects.toBe(ecError);
      expect(log.error).toHaveBeenCalledWith(
        'Failed to mark transaction as failed',
        expect.objectContaining({ paymentId: PAYMENT_ID, transactionId: 'charge-new', type: 'Charge' }),
      );
    });

    it('keeps the Charge Pending when the capture outcome is unknown, as easyCredit may have booked it', async () => {
      const payment = buildPayment(method);
      mock(getPaymentById).mockResolvedValue(payment);
      addOnUpdate(payment, 'charge-new');
      client.capturePayment.mockRejectedValue(captureTimeoutError);

      await expect(handleCapturePayment(PAYMENT_ID)).rejects.toBe(captureTimeoutError);
      expect(updateActions()).toHaveLength(1);
    });

    it('keeps the Charge Pending and answers 204 when easyCredit already has the capture', async () => {
      const payment = buildPayment(method);
      mock(getPaymentById).mockResolvedValue(payment);
      addOnUpdate(payment, 'charge-new');
      client.capturePayment.mockRejectedValue(alreadyCapturedError);

      await expect(handleCapturePayment(PAYMENT_ID)).resolves.toBeUndefined();
      expect(updateActions()).toHaveLength(1);
      expect(log.info).toHaveBeenCalledWith(
        'easyCredit already has the capture of this Charge, the Charge stays Pending',
        expect.objectContaining({ paymentId: PAYMENT_ID, transactionId: 'charge-new' }),
      );
    });

    it('sets the new Charge to Failure when easyCredit refuses a capture after an earlier one', async () => {
      const payment = buildPayment(method, [{ id: 'charge-1', type: 'Charge', state: 'Failure' }]);
      mock(getPaymentById).mockResolvedValue(payment);
      client.getMerchantTransaction.mockResolvedValue({
        status: 'REPORT_CAPTURE_FAILED',
        bookings: [captureBooking('FAILED', minutesAgo(40))],
      });
      addOnUpdate(payment, 'charge-new');
      client.capturePayment.mockRejectedValue(alreadyCapturedError);

      await expect(handleCapturePayment(PAYMENT_ID)).rejects.toBe(alreadyCapturedError);
      expect(updateActions()[1]).toEqual([
        { action: 'changeTransactionState', transactionId: 'charge-new', state: 'Failure' },
      ]);
    });

    it('rejects a payment that easyCredit does not report as AUTHORIZED', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(method));
      client.getPayment.mockResolvedValue({ status: 'PREAUTHORIZED', decision: { transactionId: EC_TX_ID } });

      await expect(handleCapturePayment(PAYMENT_ID)).rejects.toMatchObject({ code: 'TransactionIsNotAuthorized' });
      expect(client.capturePayment).not.toHaveBeenCalled();
      expect(updatePayment).not.toHaveBeenCalled();
    });

    it('ignores a second capture while a Charge is Success', async () => {
      mock(getPaymentById).mockResolvedValue(
        buildPayment(method, [{ id: 'charge-1', type: 'Charge', state: 'Success' }]),
      );

      await expect(handleCapturePayment(PAYMENT_ID)).resolves.toBeUndefined();
      expect(client.getMerchantTransaction).not.toHaveBeenCalled();
      expect(client.capturePayment).not.toHaveBeenCalled();
      expect(updatePayment).not.toHaveBeenCalled();
    });

    describe('with a Pending Charge that no notification completed', () => {
      const pendingCharge = (timestamp: string | undefined, earlierBookings?: string[]): Tx => ({
        id: 'charge-1',
        type: 'Charge',
        state: 'Pending',
        interactionId: EC_TX_ID,
        timestamp,
        ...(earlierBookings && { custom: { fields: { easyCreditEarlierCaptureBookings: earlierBookings } } }),
      });
      const withBookings = (status: string, ...bookings: object[]) =>
        client.getMerchantTransaction.mockResolvedValue({ transactionId: EC_TX_ID, status, bookings });
      const earlierFailed = captureBooking('FAILED', minutesAgo(40));
      // Dated before the Charge, as easyCredit's clock may run behind; only the uuid tells whose it is.
      const ownFailed = captureBooking('FAILED', minutesAgo(31), { messageEN: 'Declined' });

      const expectCapturedAgain = async (payment: ReturnType<typeof buildPayment>) => {
        const failed = {
          ...payment,
          version: 4,
          transactions: [authorization, { ...payment.transactions[1], state: 'Failure' }],
        };
        mock(updatePayment)
          .mockResolvedValueOnce(failed)
          .mockImplementationOnce(async (current: typeof payment, actions: Record<string, any>[]) => ({
            ...current,
            transactions: [...current.transactions, { id: 'charge-new', ...actions[0].transaction }],
          }));

        await handleCapturePayment(PAYMENT_ID, 'track-1');

        expect(updateActions()[0]).toEqual([
          { action: 'changeTransactionState', transactionId: 'charge-1', state: 'Failure' },
        ]);
        // The new Charge is added on the version that has the old one failed.
        expect(mock(updatePayment).mock.calls[1][0]).toBe(failed);
        expect(client.capturePayment).toHaveBeenCalledWith(EC_TX_ID, PAYMENT_ID, 'track-1');
      };

      it('sets the Charge to Success when easyCredit booked the capture', async () => {
        mock(getPaymentById).mockResolvedValue(buildPayment(method, [pendingCharge(minutesAgo(30))]));
        withBookings('IN_BILLING', captureBooking('DONE', minutesAgo(29)));

        await expect(handleCapturePayment(PAYMENT_ID)).resolves.toBeUndefined();
        expect(client.getMerchantTransaction).toHaveBeenCalledWith(EC_TX_ID);
        expect(updateActions()).toEqual([
          [{ action: 'changeTransactionState', transactionId: 'charge-1', state: 'Success' }],
        ]);
        expect(client.capturePayment).not.toHaveBeenCalled();
      });

      it('leaves the Charge Pending, however old, while a booking of the Charge is still open', async () => {
        mock(getPaymentById).mockResolvedValue(buildPayment(method, [pendingCharge(minutesAgo(600))]));
        // easyCredit keeps REPORT_CAPTURE while the capture booking is PENDING.
        withBookings('REPORT_CAPTURE', captureBooking('PENDING', minutesAgo(599)));

        await expect(handleCapturePayment(PAYMENT_ID)).resolves.toBeUndefined();
        expect(updatePayment).not.toHaveBeenCalled();
        expect(client.capturePayment).not.toHaveBeenCalled();
      });

      describe('without a booking of its own', () => {
        it.each([
          ['just added', 'REPORT_CAPTURE', new Date(Date.now() - 1000).toISOString(), []],
          ['hours old', 'REPORT_CAPTURE', minutesAgo(600), []],
          ['with the FAILED booking of an earlier capture', 'REPORT_CAPTURE', minutesAgo(1), [earlierFailed]],
          ['while easyCredit reports a capture', 'IN_BILLING', minutesAgo(1), []],
          ['with a status outside the documented ones', 'REPORT_CAPTURE_PENDING', minutesAgo(1), []],
          ['of an earlier version without timestamp', 'REPORT_CAPTURE', undefined, []],
        ])('sends the capture again for the same Charge, %s', async (_name, status, timestamp, bookings) => {
          mock(getPaymentById).mockResolvedValue(
            buildPayment(method, [pendingCharge(timestamp, [earlierFailed.uuid])]),
          );
          withBookings(status, ...bookings);

          await expect(handleCapturePayment(PAYMENT_ID, 'track-1')).resolves.toBeUndefined();
          expect(client.capturePayment).toHaveBeenCalledWith(EC_TX_ID, PAYMENT_ID, 'track-1');
          expect(client.getPayment).not.toHaveBeenCalled();
          expect(updatePayment).not.toHaveBeenCalled();
        });

        it('keeps the Charge Pending and answers 204 when easyCredit already has its capture', async () => {
          mock(getPaymentById).mockResolvedValue(buildPayment(method, [pendingCharge(minutesAgo(1))]));
          withBookings('REPORT_CAPTURE');
          client.capturePayment.mockRejectedValue(alreadyCapturedError);

          await expect(handleCapturePayment(PAYMENT_ID)).resolves.toBeUndefined();
          expect(updatePayment).not.toHaveBeenCalled();
        });

        it('passes a 409 after an earlier capture on and keeps the Charge Pending', async () => {
          mock(getPaymentById).mockResolvedValue(
            buildPayment(method, [pendingCharge(minutesAgo(1), [earlierFailed.uuid])]),
          );
          withBookings('REPORT_CAPTURE_FAILED', earlierFailed);
          client.capturePayment.mockRejectedValue(alreadyCapturedError);

          // The 409 may refuse the capture, so a 204 could report a capture that never happens.
          await expect(handleCapturePayment(PAYMENT_ID)).rejects.toBe(alreadyCapturedError);
          expect(updatePayment).not.toHaveBeenCalled();
          expect(log.warn).toHaveBeenCalledWith(
            'easyCredit answered 409 after an earlier capture, the Charge stays Pending',
            expect.objectContaining({ paymentId: PAYMENT_ID, transactionId: 'charge-1' }),
          );
        });

        it('keeps the Charge Pending when the outcome of the capture sent again is unknown', async () => {
          mock(getPaymentById).mockResolvedValue(buildPayment(method, [pendingCharge(minutesAgo(1))]));
          withBookings('REPORT_CAPTURE');
          client.capturePayment.mockRejectedValue(captureTimeoutError);

          await expect(handleCapturePayment(PAYMENT_ID)).rejects.toBe(captureTimeoutError);
          expect(updatePayment).not.toHaveBeenCalled();
        });

        it('sets the Charge to Failure when easyCredit rejects the capture sent again', async () => {
          mock(getPaymentById).mockResolvedValue(buildPayment(method, [pendingCharge(minutesAgo(1))]));
          withBookings('EXPIRED');
          client.capturePayment.mockRejectedValue(ecError);

          await expect(handleCapturePayment(PAYMENT_ID)).rejects.toBe(ecError);
          expect(updateActions()).toEqual([
            [{ action: 'changeTransactionState', transactionId: 'charge-1', state: 'Failure' }],
          ]);
        });
      });

      it('leaves the Charge Pending when easyCredit sends no bookings', async () => {
        mock(getPaymentById).mockResolvedValue(buildPayment(method, [pendingCharge(minutesAgo(600))]));
        client.getMerchantTransaction.mockResolvedValue({ transactionId: EC_TX_ID, status: 'REPORT_CAPTURE' });

        await expect(handleCapturePayment(PAYMENT_ID)).resolves.toBeUndefined();
        expect(updatePayment).not.toHaveBeenCalled();
        expect(client.capturePayment).not.toHaveBeenCalled();
        expect(log.warn).toHaveBeenCalledWith(
          'easyCredit sent the transaction without bookings, the Pending Charge stays open',
          expect.objectContaining({ paymentId: PAYMENT_ID, transactionId: 'charge-1' }),
        );
      });

      it('sets the Charge to Failure and captures again when easyCredit failed its booking', async () => {
        const payment = buildPayment(method, [pendingCharge(minutesAgo(30), [earlierFailed.uuid])]);
        mock(getPaymentById).mockResolvedValue(payment);
        withBookings('REPORT_CAPTURE_FAILED', earlierFailed, ownFailed);

        await expectCapturedAgain(payment);
        expect(log.warn).toHaveBeenCalledWith(
          'Pending Charge set to Failure before capturing again',
          expect.objectContaining({ reason: 'Declined' }),
        );
      });

      it.each([
        ['without custom fields', undefined],
        [
          'with a custom type that lacks the earlier bookings field',
          { fields: { easyCreditTechnicalTransactionId: TECH_ID } },
        ],
      ])('takes every FAILED booking as its own for a Charge %s', async (_name, custom) => {
        const payment = buildPayment(method, [{ ...pendingCharge(undefined), ...(custom && { custom }) }]);
        mock(getPaymentById).mockResolvedValue(payment);
        withBookings('REPORT_CAPTURE_FAILED', ownFailed);

        await expectCapturedAgain(payment);
      });

      describe('when the stored list missed a booking of an earlier capture', () => {
        it('completes the Charge from a DONE booking, as the payment is captured', async () => {
          mock(getPaymentById).mockResolvedValue(buildPayment(method, [pendingCharge(minutesAgo(1), [])]));
          withBookings('IN_BILLING', captureBooking('DONE', minutesAgo(40)));

          await handleCapturePayment(PAYMENT_ID);

          expect(updateActions()).toEqual([
            [{ action: 'changeTransactionState', transactionId: 'charge-1', state: 'Success' }],
          ]);
          expect(client.capturePayment).not.toHaveBeenCalled();
        });

        it('fails the Charge from a FAILED booking, and easyCredit refuses the second capture', async () => {
          const payment = buildPayment(method, [pendingCharge(minutesAgo(1), [])]);
          mock(getPaymentById).mockResolvedValue(payment);
          withBookings('REPORT_CAPTURE_FAILED', earlierFailed);
          client.capturePayment.mockRejectedValue(alreadyCapturedError);
          mock(updatePayment)
            .mockResolvedValueOnce({
              ...payment,
              transactions: [authorization, { ...payment.transactions[1], state: 'Failure' }],
            })
            .mockImplementationOnce(async (current: typeof payment, actions: Record<string, any>[]) => ({
              ...current,
              transactions: [...current.transactions, { id: 'charge-new', ...actions[0].transaction }],
            }));

          await expect(handleCapturePayment(PAYMENT_ID)).rejects.toBe(alreadyCapturedError);
          // The new Charge lists the booking, so the 409 to its first capture fails it and reaches the caller.
          expect(updateActions()[1][0]).toMatchObject({
            transaction: { custom: { fields: { easyCreditEarlierCaptureBookings: [earlierFailed.uuid] } } },
          });
          expect(updateActions()[2]).toEqual([
            { action: 'changeTransactionState', transactionId: 'charge-new', state: 'Failure' },
          ]);
        });
      });

      it('does not capture again when a notification completed the Charge meanwhile', async () => {
        const payment = buildPayment(method, [pendingCharge(minutesAgo(20))]);
        mock(getPaymentById)
          .mockResolvedValueOnce(payment)
          .mockResolvedValueOnce(buildPayment(method, [{ ...pendingCharge(minutesAgo(20)), state: 'Success' }]));
        withBookings('REPORT_CAPTURE_FAILED', ownFailed);
        mock(updatePayment).mockRejectedValueOnce(conflictError);

        await expect(handleCapturePayment(PAYMENT_ID)).resolves.toBeUndefined();
        expect(client.capturePayment).not.toHaveBeenCalled();
      });

      it('reads easyCredit once for the open refunds and the Charge', async () => {
        mock(getPaymentById).mockResolvedValue(
          buildPayment(method, [
            pendingCharge(minutesAgo(30)),
            { id: 'refund-1', type: 'Refund', state: 'Pending', amount: cents(1000) },
          ]),
        );
        withBookings('REPORT_CAPTURE', captureBooking('PENDING', minutesAgo(29)));

        await handleCapturePayment(PAYMENT_ID);

        expect(client.getMerchantTransaction).toHaveBeenCalledTimes(1);
        expect(client.getPayment).not.toHaveBeenCalled();
      });

      it.each([
        ['a timeout', new DOMException('aborted', 'TimeoutError'), 504],
        ['a network error', new TypeError('fetch failed'), 502],
      ])('answers %s of the booking read with CaptureFailed', async (_name, error, status) => {
        mock(getPaymentById).mockResolvedValue(buildPayment(method, [pendingCharge(minutesAgo(1))]));
        client.getMerchantTransaction.mockRejectedValue(error);

        await expect(handleCapturePayment(PAYMENT_ID)).rejects.toMatchObject({
          code: 'CaptureFailed',
          httpErrorStatus: status,
        });
        expect(updatePayment).not.toHaveBeenCalled();
        expect(client.capturePayment).not.toHaveBeenCalled();
      });
    });

    describe('with the capture bookings of easyCredit', () => {
      it('stores the bookings listed before it on the new Charge', async () => {
        const payment = buildPayment(method, [{ id: 'charge-1', type: 'Charge', state: 'Failure' }]);
        const failed = captureBooking('FAILED', minutesAgo(40));
        mock(getPaymentById).mockResolvedValue(payment);
        client.getMerchantTransaction.mockResolvedValue({
          status: 'REPORT_CAPTURE_FAILED',
          bookings: [failed, { bookingType: 'ApiBooking', type: 'NOTIFY', uuid: 'notify-1' }],
        });
        addOnUpdate(payment, 'charge-new');

        await handleCapturePayment(PAYMENT_ID);

        expect(updateActions()[0][0]).toMatchObject({
          transaction: {
            custom: {
              fields: {
                easyCreditTechnicalTransactionId: TECH_ID,
                easyCreditEarlierCaptureBookings: [failed.uuid],
              },
            },
          },
        });
        expect(client.capturePayment).toHaveBeenCalledTimes(1);
      });

      it('stores no bookings for a payment that never had a Charge, even when easyCredit lists one', async () => {
        const payment = buildPayment(method, [
          { id: 'refund-1', type: 'Refund', state: 'Pending', amount: cents(1000) },
        ]);
        mock(getPaymentById).mockResolvedValue(payment);
        client.getMerchantTransaction.mockResolvedValue({
          status: 'REPORT_CAPTURE',
          bookings: [captureBooking('PENDING', minutesAgo(1))],
        });
        addOnUpdate(payment, 'charge-new');

        await handleCapturePayment(PAYMENT_ID);

        expect(updateActions()[0][0]).toMatchObject({
          transaction: { custom: { fields: { easyCreditTechnicalTransactionId: TECH_ID } } },
        });
        expect(JSON.stringify(updateActions()[0][0])).not.toContain('easyCreditEarlierCaptureBookings');
      });

      it('captures a payment that never had a Charge when the read for open refunds fails', async () => {
        const payment = buildPayment(method, [
          { id: 'refund-1', type: 'Refund', state: 'Pending', amount: cents(1000) },
        ]);
        mock(getPaymentById).mockResolvedValue(payment);
        client.getMerchantTransaction.mockRejectedValue(new TypeError('fetch failed'));
        addOnUpdate(payment, 'charge-new');

        await handleCapturePayment(PAYMENT_ID);

        expect(client.capturePayment).toHaveBeenCalledTimes(1);
      });

      it('does not capture again without bookings, as an earlier capture could not be told apart', async () => {
        mock(getPaymentById).mockResolvedValue(
          buildPayment(method, [{ id: 'charge-1', type: 'Charge', state: 'Failure' }]),
        );
        client.getMerchantTransaction.mockResolvedValue({ status: 'REPORT_CAPTURE_FAILED' });

        await expect(handleCapturePayment(PAYMENT_ID)).rejects.toMatchObject({
          code: 'CaptureFailed',
          httpErrorStatus: 502,
        });
        expect(updatePayment).not.toHaveBeenCalled();
        expect(client.capturePayment).not.toHaveBeenCalled();
      });

      it.each([
        ['a timeout', new DOMException('aborted', 'TimeoutError'), 504],
        ['a network error', new TypeError('fetch failed'), 502],
      ])('answers %s of the booking read after a failed capture with CaptureFailed', async (_name, error, status) => {
        mock(getPaymentById).mockResolvedValue(
          buildPayment(method, [{ id: 'charge-1', type: 'Charge', state: 'Failure' }]),
        );
        client.getMerchantTransaction.mockRejectedValue(error);

        await expect(handleCapturePayment(PAYMENT_ID)).rejects.toMatchObject({
          code: 'CaptureFailed',
          httpErrorStatus: status,
        });
        expect(updatePayment).not.toHaveBeenCalled();
        expect(client.capturePayment).not.toHaveBeenCalled();
      });
    });

    it('ignores the capture when a parallel request added its Charge first', async () => {
      const payment = buildPayment(method);
      mock(getPaymentById)
        .mockResolvedValueOnce(payment)
        .mockResolvedValueOnce(buildPayment(method, [{ id: 'charge-other', type: 'Charge', state: 'Pending' }]));
      mock(updatePayment).mockRejectedValue(conflictError);

      await expect(handleCapturePayment(PAYMENT_ID)).resolves.toBeUndefined();
      expect(client.capturePayment).not.toHaveBeenCalled();
    });

    it('passes a version conflict on when no other Charge was added', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(method));
      mock(updatePayment).mockRejectedValue(conflictError);

      await expect(handleCapturePayment(PAYMENT_ID)).rejects.toBe(conflictError);
      expect(client.capturePayment).not.toHaveBeenCalled();
    });
    it.each([
      ['a timeout', new DOMException('aborted', 'TimeoutError'), 504],
      ['a network error', new TypeError('fetch failed'), 502],
    ])('answers %s of the status read with CaptureFailed and adds no Charge', async (_name, error, status) => {
      mock(getPaymentById).mockResolvedValue(buildPayment(method));
      client.getPayment.mockRejectedValue(error);

      await expect(handleCapturePayment(PAYMENT_ID)).rejects.toMatchObject({
        code: 'CaptureFailed',
        httpErrorStatus: status,
        cause: error,
      });
      expect(updatePayment).not.toHaveBeenCalled();
      expect(client.capturePayment).not.toHaveBeenCalled();
    });

    it.each([401, 403])('passes a %s of the status read on and adds no Charge', async (status) => {
      const authError = new Errorx({ code: 'Unauthorized', message: 'Unauthorized', httpErrorStatus: status });
      mock(getPaymentById).mockResolvedValue(buildPayment(method));
      client.getPayment.mockRejectedValue(authError);

      await expect(handleCapturePayment(PAYMENT_ID)).rejects.toBe(authError);
      expect(updatePayment).not.toHaveBeenCalled();
    });

    it.each([401, 403])('sets the Charge to Failure and passes a %s of the capture on', async (status) => {
      const authError = new Errorx({ code: 'Unauthorized', message: 'Unauthorized', httpErrorStatus: status });
      const payment = buildPayment(method);
      mock(getPaymentById).mockResolvedValue(payment);
      addOnUpdate(payment, 'charge-new');
      client.capturePayment.mockRejectedValue(authError);

      await expect(handleCapturePayment(PAYMENT_ID)).rejects.toBe(authError);
      expect(updateActions()[1]).toEqual([
        { action: 'changeTransactionState', transactionId: 'charge-new', state: 'Failure' },
      ]);
    });

    it('allows a new capture after a failed one', async () => {
      const payment = buildPayment(method, [{ id: 'charge-1', type: 'Charge', state: 'Failure' }]);
      mock(getPaymentById).mockResolvedValue(payment);
      addOnUpdate(payment, 'charge-new');

      await handleCapturePayment(PAYMENT_ID);

      expect(client.capturePayment).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleRefundPayment', () => {
    it.each([
      ['partial', 25],
      ['full', 100],
    ])('TEBA-222: sends a %s refund with the new transaction as booking and sets it Pending', async (_name, amount) => {
      const payment = buildPayment(method, [{ id: 'charge-1', type: 'Charge', state: 'Success' }]);
      mock(getPaymentById).mockResolvedValue(payment);
      addOnUpdate(payment, 'refund-new');

      const result = await handleRefundPayment(PAYMENT_ID, amount);

      expect(client.refundPayment).toHaveBeenCalledWith(EC_TX_ID, { value: amount, bookingId: 'refund-new' });
      expect(updateActions()[1]).toEqual([
        { action: 'changeTransactionState', transactionId: 'refund-new', state: 'Pending' },
      ]);
      expect(result.transactions.find((t: Tx) => t.id === 'refund-new')).toMatchObject({ type: 'Refund' });
    });

    it('TEBA-222: uses its own booking ID while an earlier refund is still Initial', async () => {
      const payment = buildPayment(method, [
        { id: 'charge-1', type: 'Charge', state: 'Success' },
        { id: 'refund-other', type: 'Refund', state: 'Initial', amount: cents(1000), timestamp: minutesAgo(1) },
        { id: 'refund-pending', type: 'Refund', state: 'Pending', amount: cents(1000), timestamp: minutesAgo(1) },
      ]);
      mock(getPaymentById).mockResolvedValue(payment);
      addOnUpdate(payment, 'refund-new');

      await handleRefundPayment(PAYMENT_ID, 10);

      expect(client.refundPayment).toHaveBeenCalledWith(EC_TX_ID, { value: 10, bookingId: 'refund-new' });
    });

    it('TEBA-222: finds its refund when CT does not put it at the end', async () => {
      const payment = buildPayment(method, [
        { id: 'refund-other', type: 'Refund', state: 'Initial', amount: cents(1000), timestamp: minutesAgo(1) },
      ]);
      mock(getPaymentById).mockResolvedValue(payment);
      addOnUpdate(payment, 'refund-new', 'start');

      await handleRefundPayment(PAYMENT_ID, 10);

      expect(client.refundPayment).toHaveBeenCalledWith(EC_TX_ID, { value: 10, bookingId: 'refund-new' });
    });

    it('TEBA-223: sets the refund to Failure and answers with the payment when easyCredit rejects it', async () => {
      const payment = buildPayment(method);
      const failed = { ...payment, version: 5 };
      mock(getPaymentById).mockResolvedValue(payment);
      mock(updatePayment)
        .mockImplementationOnce(async (current: typeof payment) => ({
          ...current,
          transactions: [...current.transactions, { id: 'refund-new', type: 'Refund', state: 'Initial' }],
        }))
        .mockResolvedValueOnce(failed);
      client.refundPayment.mockRejectedValue(ecError);

      await expect(handleRefundPayment(PAYMENT_ID, 10)).resolves.toBe(failed);
      expect(updateActions()[1]).toEqual([
        { action: 'changeTransactionState', transactionId: 'refund-new', state: 'Failure' },
      ]);
      expect(log.error).toHaveBeenCalledWith(
        'easyCredit did not accept the refund',
        expect.objectContaining({
          paymentId: PAYMENT_ID,
          transactionId: 'refund-new',
          state: 'Failure',
          error: ecError,
        }),
      );
    });

    it('passes the update error on when the Failure state cannot be saved, as nothing was booked', async () => {
      const payment = buildPayment(method);
      const updateError = new Errorx({ code: 'General', message: 'CT down', httpErrorStatus: 503 });
      mock(getPaymentById).mockResolvedValue(payment);
      mock(updatePayment)
        .mockImplementationOnce(async (current: typeof payment) => ({
          ...current,
          transactions: [...current.transactions, { id: 'refund-new', type: 'Refund', state: 'Initial' }],
        }))
        .mockRejectedValueOnce(updateError);
      client.refundPayment.mockRejectedValue(ecError);

      await expect(handleRefundPayment(PAYMENT_ID, 10)).rejects.toBe(updateError);
    });

    it('keeps the refund Pending and answers with the payment when the easyCredit outcome is unknown', async () => {
      const payment = buildPayment(method);
      mock(getPaymentById).mockResolvedValue(payment);
      addOnUpdate(payment, 'refund-new');
      client.refundPayment.mockRejectedValue(timeoutError);

      const result = await handleRefundPayment(PAYMENT_ID, 10);

      expect(updateActions()[1]).toEqual([
        { action: 'changeTransactionState', transactionId: 'refund-new', state: 'Pending' },
      ]);
      expect(result.transactions.find((t: Tx) => t.id === 'refund-new')).toMatchObject({ type: 'Refund' });
      expect(log.error).toHaveBeenCalledWith(
        'easyCredit did not accept the refund',
        expect.objectContaining({ paymentId: PAYMENT_ID, state: 'Pending', error: timeoutError }),
      );
    });

    it('answers with the Initial refund when the outcome is unknown and the Pending state cannot be saved', async () => {
      const payment = buildPayment(method);
      mock(getPaymentById).mockResolvedValue(payment);
      mock(updatePayment)
        .mockImplementationOnce(async (current: typeof payment) => ({
          ...current,
          transactions: [...current.transactions, { id: 'refund-new', type: 'Refund', state: 'Initial' }],
        }))
        .mockRejectedValueOnce(new Errorx({ code: 'General', message: 'CT down', httpErrorStatus: 503 }));
      client.refundPayment.mockRejectedValue(timeoutError);

      const result = await handleRefundPayment(PAYMENT_ID, 10);

      expect(result.transactions.find((t: Tx) => t.id === 'refund-new')).toMatchObject({ state: 'Initial' });
      expect(log.error).toHaveBeenCalledWith(
        'The refund is open at easyCredit, but its Pending state was not saved',
        expect.objectContaining({ paymentId: PAYMENT_ID, transactionId: 'refund-new' }),
      );
    });

    describe('when a parallel request changed the payment after easyCredit accepted the refund', () => {
      const added = { id: 'refund-new', type: 'Refund', state: 'Initial' };
      const withRefund = (payment: ReturnType<typeof buildPayment>, refund: Tx, version: number) => ({
        ...payment,
        version,
        transactions: [...payment.transactions, refund, { id: 'refund-parallel', type: 'Refund', state: 'Pending' }],
      });

      it('sets the refund Pending on the latest version', async () => {
        const payment = buildPayment(method);
        const latest = withRefund(payment, added, 5);
        mock(getPaymentById).mockResolvedValueOnce(payment).mockResolvedValueOnce(latest);
        mock(updatePayment)
          .mockImplementationOnce(async (current: typeof payment) => ({
            ...current,
            transactions: [...current.transactions, added],
          }))
          .mockRejectedValueOnce(conflictError)
          .mockImplementationOnce(async (current: typeof payment) => current);

        const result = await handleRefundPayment(PAYMENT_ID, 10);

        expect(mock(updatePayment).mock.calls[2]).toEqual([
          latest,
          [{ action: 'changeTransactionState', transactionId: 'refund-new', state: 'Pending' }],
        ]);
        expect(result).toBe(latest);
      });

      it('does not overwrite a refund that the notification completed meanwhile', async () => {
        const payment = buildPayment(method);
        const latest = withRefund(payment, { ...added, state: 'Success' }, 5);
        mock(getPaymentById).mockResolvedValueOnce(payment).mockResolvedValueOnce(latest);
        mock(updatePayment)
          .mockImplementationOnce(async (current: typeof payment) => ({
            ...current,
            transactions: [...current.transactions, added],
          }))
          .mockRejectedValueOnce(conflictError);

        const result = await handleRefundPayment(PAYMENT_ID, 10);

        expect(updatePayment).toHaveBeenCalledTimes(2);
        expect(result).toBe(latest);
      });

      it('still answers with the payment when the Pending state cannot be saved', async () => {
        const payment = buildPayment(method);
        mock(getPaymentById).mockResolvedValue(payment);
        mock(updatePayment)
          .mockImplementationOnce(async (current: typeof payment) => ({
            ...current,
            transactions: [...current.transactions, added],
          }))
          .mockRejectedValueOnce(new Errorx({ code: 'General', message: 'CT down', httpErrorStatus: 503 }));

        const result = await handleRefundPayment(PAYMENT_ID, 10);

        expect(result.transactions.find((t: Tx) => t.id === 'refund-new')).toMatchObject({ state: 'Initial' });
        expect(log.error).toHaveBeenCalledWith(
          'The refund is open at easyCredit, but its Pending state was not saved',
          expect.objectContaining({ paymentId: PAYMENT_ID, transactionId: 'refund-new' }),
        );
      });

      it('gives up after three version conflicts', async () => {
        const payment = buildPayment(method);
        mock(getPaymentById)
          .mockResolvedValueOnce(payment)
          .mockResolvedValue(withRefund(payment, added, 5));
        mock(updatePayment)
          .mockImplementationOnce(async (current: typeof payment) => ({
            ...current,
            transactions: [...current.transactions, added],
          }))
          .mockRejectedValue(conflictError);

        await handleRefundPayment(PAYMENT_ID, 10);

        // One add and three state writes.
        expect(updatePayment).toHaveBeenCalledTimes(4);
        expect(log.error).toHaveBeenCalledWith(
          'The refund is open at easyCredit, but its Pending state was not saved',
          expect.objectContaining({ error: conflictError }),
        );
      });
    });

    it.each([401, 403])('sets the refund to Failure and answers with the payment on a %s', async (status) => {
      const payment = buildPayment(method);
      mock(getPaymentById).mockResolvedValue(payment);
      addOnUpdate(payment, 'refund-new');
      client.refundPayment.mockRejectedValue(
        new Errorx({ code: 'Forbidden', message: 'Forbidden', httpErrorStatus: status }),
      );

      const result = await handleRefundPayment(PAYMENT_ID, 10);

      expect(updateActions()[1]).toEqual([
        { action: 'changeTransactionState', transactionId: 'refund-new', state: 'Failure' },
      ]);
      expect(result.transactions.find((t: Tx) => t.id === 'refund-new')).toMatchObject({ type: 'Refund' });
    });

    it('passes a version conflict on adding the refund on without calling easyCredit', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(method));
      mock(updatePayment).mockRejectedValue(conflictError);

      await expect(handleRefundPayment(PAYMENT_ID, 10)).rejects.toBe(conflictError);
      expect(client.refundPayment).not.toHaveBeenCalled();
    });

    it.each([0, -1, 100.01, 10.005, 0.001])(
      'TEBA-223: rejects the refund amount %s without calling easyCredit',
      async (amount) => {
        mock(getPaymentById).mockResolvedValue(buildPayment(method));

        await expect(handleRefundPayment(PAYMENT_ID, amount)).rejects.toMatchObject({ code: 'InvalidRefundAmount' });
        expect(client.refundPayment).not.toHaveBeenCalled();
        expect(updatePayment).not.toHaveBeenCalled();
      },
    );

    describe('with open refunds that no notification completed', () => {
      const refundBooking = (bookingId: string, status: string) => ({
        bookingType: 'RefundBooking',
        type: 'REFUND',
        uuid: `uuid-${bookingId}`,
        created: minutesAgo(30),
        status,
        bookingId,
      });

      it('settles them from the easyCredit bookings before checking the remaining amount', async () => {
        const payment = buildPayment(method, [
          { id: 'refund-done', type: 'Refund', state: 'Pending', amount: cents(4000), timestamp: minutesAgo(30) },
          { id: 'refund-failed', type: 'Refund', state: 'Initial', amount: cents(6000), timestamp: minutesAgo(30) },
        ]);
        mock(getPaymentById).mockResolvedValue(payment);
        client.getMerchantTransaction.mockResolvedValue({
          bookings: [refundBooking('refund-done', 'DONE'), refundBooking('refund-failed', 'FAILED')],
        });
        addOnUpdate(payment, 'refund-new');

        // 60 € fit only because the refund easyCredit failed no longer counts.
        await handleRefundPayment(PAYMENT_ID, 60);

        expect(client.getMerchantTransaction).toHaveBeenCalledWith(EC_TX_ID);
        expect(updateActions()[0]).toEqual([
          { action: 'changeTransactionState', transactionId: 'refund-done', state: 'Success' },
          { action: 'changeTransactionState', transactionId: 'refund-failed', state: 'Failure' },
        ]);
        expect(client.refundPayment).toHaveBeenCalledWith(EC_TX_ID, { value: 60, bookingId: 'refund-new' });
      });

      it.each([
        ['an old refund', minutesAgo(600)],
        ['a refund of an earlier version without timestamp', undefined],
      ])('keeps %s without booking open, as easyCredit may still book it', async (_name, timestamp) => {
        const payment = buildPayment(method, [
          { id: 'refund-unbooked', type: 'Refund', state: 'Pending', amount: cents(6000), timestamp },
        ]);
        mock(getPaymentById).mockResolvedValue(payment);
        client.getMerchantTransaction.mockResolvedValue({ bookings: [refundBooking('other', 'DONE')] });

        await expect(handleRefundPayment(PAYMENT_ID, 60)).rejects.toMatchObject({ code: 'InvalidRefundAmount' });
        expect(updatePayment).not.toHaveBeenCalled();
      });

      it('keeps them open when easyCredit sends no bookings', async () => {
        mock(getPaymentById).mockResolvedValue(
          buildPayment(method, [{ id: 'refund-open', type: 'Refund', state: 'Pending', amount: cents(6000) }]),
        );
        client.getMerchantTransaction.mockResolvedValue({ transactionId: EC_TX_ID });

        await expect(handleRefundPayment(PAYMENT_ID, 60)).rejects.toMatchObject({ code: 'InvalidRefundAmount' });
        expect(updatePayment).not.toHaveBeenCalled();
        expect(log.warn).toHaveBeenCalledWith(
          'easyCredit sent the transaction without bookings, open refunds stay open',
          expect.objectContaining({ paymentId: PAYMENT_ID }),
        );
      });

      it('rejects a malformed amount before reading the payment or easyCredit', async () => {
        mock(getPaymentById).mockResolvedValue(
          buildPayment(method, [{ id: 'refund-open', type: 'Refund', state: 'Pending', amount: cents(1000) }]),
        );

        await expect(handleRefundPayment(PAYMENT_ID, 10.005)).rejects.toMatchObject({ code: 'InvalidRefundAmount' });
        expect(getPaymentById).not.toHaveBeenCalled();
        expect(client.getMerchantTransaction).not.toHaveBeenCalled();
      });

      it('settles them on a capture request too', async () => {
        const payment = buildPayment(method, [
          { id: 'refund-done', type: 'Refund', state: 'Pending', amount: cents(4000), timestamp: minutesAgo(30) },
        ]);
        mock(getPaymentById).mockResolvedValue(payment);
        client.getMerchantTransaction.mockResolvedValue({ bookings: [refundBooking('refund-done', 'DONE')] });
        addOnUpdate(payment, 'charge-new');

        await handleCapturePayment(PAYMENT_ID);

        expect(updateActions()[0]).toEqual([
          { action: 'changeTransactionState', transactionId: 'refund-done', state: 'Success' },
        ]);
        expect(client.capturePayment).toHaveBeenCalledTimes(1);
      });

      it('goes on with the refund when easyCredit cannot be read', async () => {
        const payment = buildPayment(method, [
          { id: 'refund-open', type: 'Refund', state: 'Pending', amount: cents(4000), timestamp: minutesAgo(30) },
        ]);
        mock(getPaymentById).mockResolvedValue(payment);
        client.getMerchantTransaction.mockRejectedValue(new TypeError('fetch failed'));
        addOnUpdate(payment, 'refund-new');

        await handleRefundPayment(PAYMENT_ID, 10);

        expect(log.warn).toHaveBeenCalledWith(
          'easyCredit bookings could not be read, open refunds stay open',
          expect.objectContaining({ paymentId: PAYMENT_ID }),
        );
        expect(client.refundPayment).toHaveBeenCalledTimes(1);
      });

      it('goes on with the refund on the latest payment when the settled state cannot be saved', async () => {
        const payment = buildPayment(method, [
          { id: 'refund-open', type: 'Refund', state: 'Pending', amount: cents(4000), timestamp: minutesAgo(30) },
        ]);
        mock(getPaymentById).mockResolvedValue(payment);
        client.getMerchantTransaction.mockResolvedValue({ bookings: [refundBooking('refund-open', 'DONE')] });
        addOnUpdate(payment, 'refund-new');
        mock(updatePayment).mockRejectedValueOnce(conflictError);

        await handleRefundPayment(PAYMENT_ID, 10);

        expect(getPaymentById).toHaveBeenCalledTimes(2);
        expect(log.warn).toHaveBeenCalledWith(
          'Open refunds could not be settled from the easyCredit bookings',
          expect.objectContaining({ paymentId: PAYMENT_ID }),
        );
        expect(client.refundPayment).toHaveBeenCalledTimes(1);
      });

      it('does not read easyCredit without open refunds', async () => {
        const payment = buildPayment(method, [
          { id: 'refund-old', type: 'Refund', state: 'Success', amount: cents(1000) },
        ]);
        mock(getPaymentById).mockResolvedValue(payment);
        addOnUpdate(payment, 'refund-new');

        await handleRefundPayment(PAYMENT_ID, 10);

        expect(client.getMerchantTransaction).not.toHaveBeenCalled();
      });
    });

    it('sends easyCredit the same amount that the Refund transaction holds', async () => {
      const payment = buildPayment(method);
      mock(getPaymentById).mockResolvedValue(payment);
      addOnUpdate(payment, 'refund-new');

      await handleRefundPayment(PAYMENT_ID, 19.99);

      expect(updateActions()[0]).toEqual([
        expect.objectContaining({
          transaction: expect.objectContaining({
            amount: { centAmount: 1999, currencyCode: 'EUR' },
            timestamp: expect.any(String),
          }),
        }),
      ]);
      expect(client.refundPayment).toHaveBeenCalledWith(EC_TX_ID, { value: 19.99, bookingId: 'refund-new' });
    });

    it('rejects a refund above the amount that earlier refunds left', async () => {
      mock(getPaymentById).mockResolvedValue(
        buildPayment(method, [
          { id: 'refund-1', type: 'Refund', state: 'Success', amount: cents(6000) },
          { id: 'refund-2', type: 'Refund', state: 'Pending', amount: cents(3000), timestamp: minutesAgo(1) },
          { id: 'refund-3', type: 'Refund', state: 'Failure', amount: cents(5000) },
        ]),
      );

      await expect(handleRefundPayment(PAYMENT_ID, 10.01)).rejects.toMatchObject({ code: 'InvalidRefundAmount' });
      expect(client.refundPayment).not.toHaveBeenCalled();
    });
  });
});
