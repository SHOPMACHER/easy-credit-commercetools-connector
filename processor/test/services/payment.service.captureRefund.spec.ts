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
type Tx = { id: string; type: string; state: string; interactionId?: string; amount?: object; custom?: object };
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

const ecError = new Errorx({ code: 'Booking not allowed', message: 'Booking not allowed', httpErrorStatus: 409 });
const conflictError = new Errorx({ code: 'ConcurrentModification', message: 'Version mismatch', httpErrorStatus: 409 });
const timeoutError = new ECOutcomeUnknownError({
  code: 'RefundFailed',
  message: 'Refund failed',
  httpErrorStatus: 504,
});

const client = {
  getPayment: jest.fn<AnyFn>(),
  capturePayment: jest.fn<AnyFn>(),
  refundPayment: jest.fn<AnyFn>(),
};

const updateActions = () => mock(updatePayment).mock.calls.map((c) => c[1] as Record<string, unknown>[]);

// CT does not specify where an added transaction lands in the array, so tests place it at either end.
const addOnUpdate = (payment: ReturnType<typeof buildPayment>, newId: string, position: 'end' | 'start' = 'end') =>
  mock(updatePayment).mockImplementation(async (current: typeof payment, actions: Record<string, any>[]) => {
    const add = actions.find((a) => a.action === 'addTransaction');
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

    it('TEBA-222: still captures when a refund was registered before shipping', async () => {
      const payment = buildPayment(method, [{ id: 'refund-1', type: 'Refund', state: 'Pending' }]);
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

    it('rejects a payment that easyCredit does not report as AUTHORIZED', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(method));
      client.getPayment.mockResolvedValue({ status: 'PREAUTHORIZED', decision: { transactionId: EC_TX_ID } });

      await expect(handleCapturePayment(PAYMENT_ID)).rejects.toMatchObject({ code: 'TransactionIsNotAuthorized' });
      expect(client.capturePayment).not.toHaveBeenCalled();
      expect(updatePayment).not.toHaveBeenCalled();
    });

    it.each(['Pending', 'Success'])('ignores a second capture while a Charge is %s', async (state) => {
      mock(getPaymentById).mockResolvedValue(buildPayment(method, [{ id: 'charge-1', type: 'Charge', state }]));

      await expect(handleCapturePayment(PAYMENT_ID)).resolves.toBeUndefined();
      expect(client.getPayment).not.toHaveBeenCalled();
      expect(client.capturePayment).not.toHaveBeenCalled();
      expect(updatePayment).not.toHaveBeenCalled();
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

    it('sets the Charge to Failure when the capture outcome is unknown, so it can be retried', async () => {
      const payment = buildPayment(method);
      mock(getPaymentById).mockResolvedValue(payment);
      addOnUpdate(payment, 'charge-new');
      client.capturePayment.mockRejectedValue(timeoutError);

      await expect(handleCapturePayment(PAYMENT_ID)).rejects.toBe(timeoutError);
      expect(updateActions()[1]).toEqual([
        { action: 'changeTransactionState', transactionId: 'charge-new', state: 'Failure' },
      ]);
    });

    it.each([401, 403])('answers 502 when easyCredit rejects the connector credentials with %s', async (status) => {
      const authError = new Errorx({ code: 'Unauthorized', message: 'Unauthorized', httpErrorStatus: status });
      mock(getPaymentById).mockResolvedValue(buildPayment(method));
      client.getPayment.mockRejectedValue(authError);

      await expect(handleCapturePayment(PAYMENT_ID)).rejects.toMatchObject({
        code: 'UpstreamAuthenticationFailed',
        httpErrorStatus: 502,
        cause: authError,
      });
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
        { id: 'refund-other', type: 'Refund', state: 'Initial' },
        { id: 'refund-pending', type: 'Refund', state: 'Pending' },
      ]);
      mock(getPaymentById).mockResolvedValue(payment);
      addOnUpdate(payment, 'refund-new');

      await handleRefundPayment(PAYMENT_ID, 10);

      expect(client.refundPayment).toHaveBeenCalledWith(EC_TX_ID, { value: 10, bookingId: 'refund-new' });
    });

    it('TEBA-222: finds its refund when CT does not put it at the end', async () => {
      const payment = buildPayment(method, [{ id: 'refund-other', type: 'Refund', state: 'Initial' }]);
      mock(getPaymentById).mockResolvedValue(payment);
      addOnUpdate(payment, 'refund-new', 'start');

      await handleRefundPayment(PAYMENT_ID, 10);

      expect(client.refundPayment).toHaveBeenCalledWith(EC_TX_ID, { value: 10, bookingId: 'refund-new' });
    });

    it('TEBA-223: sets the refund to Failure and passes the easyCredit error on', async () => {
      const payment = buildPayment(method);
      mock(getPaymentById).mockResolvedValue(payment);
      addOnUpdate(payment, 'refund-new');
      client.refundPayment.mockRejectedValue(ecError);

      await expect(handleRefundPayment(PAYMENT_ID, 10)).rejects.toBe(ecError);
      expect(updateActions()[1]).toEqual([
        { action: 'changeTransactionState', transactionId: 'refund-new', state: 'Failure' },
      ]);
    });

    it('keeps the easyCredit error when marking the refund as failed fails too', async () => {
      const payment = buildPayment(method);
      mock(getPaymentById).mockResolvedValue(payment);
      addOnUpdate(payment, 'refund-new');
      mock(updatePayment)
        .mockImplementationOnce(async (current: typeof payment) => ({
          ...current,
          transactions: [...current.transactions, { id: 'refund-new', type: 'Refund', state: 'Initial' }],
        }))
        .mockRejectedValueOnce(new Error('ConcurrentModification'));
      client.refundPayment.mockRejectedValue(ecError);

      await expect(handleRefundPayment(PAYMENT_ID, 10)).rejects.toBe(ecError);
      expect(log.error).toHaveBeenCalledWith(
        'Failed to mark transaction as failed',
        expect.objectContaining({ paymentId: PAYMENT_ID, transactionId: 'refund-new', type: 'Refund' }),
      );
    });

    it('keeps the refund Pending and passes the error on when the easyCredit outcome is unknown', async () => {
      const payment = buildPayment(method);
      mock(getPaymentById).mockResolvedValue(payment);
      addOnUpdate(payment, 'refund-new');
      client.refundPayment.mockRejectedValue(timeoutError);

      await expect(handleRefundPayment(PAYMENT_ID, 10)).rejects.toBe(timeoutError);
      expect(updateActions()[1]).toEqual([
        { action: 'changeTransactionState', transactionId: 'refund-new', state: 'Pending' },
      ]);
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
          'Refund accepted by easyCredit, but its Pending state was not saved',
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
          'Refund accepted by easyCredit, but its Pending state was not saved',
          expect.objectContaining({ error: conflictError }),
        );
      });
    });

    it('answers 502 when easyCredit rejects the connector credentials', async () => {
      const payment = buildPayment(method);
      mock(getPaymentById).mockResolvedValue(payment);
      addOnUpdate(payment, 'refund-new');
      client.refundPayment.mockRejectedValue(
        new Errorx({ code: 'Forbidden', message: 'Forbidden', httpErrorStatus: 403 }),
      );

      await expect(handleRefundPayment(PAYMENT_ID, 10)).rejects.toMatchObject({
        code: 'UpstreamAuthenticationFailed',
        httpErrorStatus: 502,
      });
      expect(updateActions()[1]).toEqual([
        { action: 'changeTransactionState', transactionId: 'refund-new', state: 'Failure' },
      ]);
    });

    it.each([0, -1, 100.01])('TEBA-223: rejects the refund amount %s without calling easyCredit', async (amount) => {
      mock(getPaymentById).mockResolvedValue(buildPayment(method));

      await expect(handleRefundPayment(PAYMENT_ID, amount)).rejects.toMatchObject({ code: 'InvalidRefundAmount' });
      expect(client.refundPayment).not.toHaveBeenCalled();
      expect(updatePayment).not.toHaveBeenCalled();
    });
  });
});
