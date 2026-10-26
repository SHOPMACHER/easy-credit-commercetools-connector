import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Errorx } from '@commercetools/connect-payments-sdk';
import { handleCapturePayment, handleRefundPayment } from '../../src/services/payment.service';
import { getPaymentById, updatePayment } from '../../src/commercetools/payment.commercetools';
import { initEasyCreditClient } from '../../src/client/easycredit.client';
import { log } from '../../src/libs/logger';

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

const buildPayment = (method: string, extra: Tx[] = []) => ({
  id: PAYMENT_ID,
  version: 3,
  amountPlanned: { centAmount: 10000, currencyCode: 'EUR', fractionDigits: 2 },
  paymentMethodInfo: { paymentInterface: 'easycredit', method },
  transactions: [authorization, ...extra],
});

const ecError = new Errorx({ code: 'Booking not allowed', message: 'Booking not allowed', httpErrorStatus: 409 });

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

describe.each(['INSTALLMENT_PAYMENT', 'BILL_PAYMENT', 'easycredit'])('capture and refund (%s)', (method) => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.values(client).forEach((fn) => fn.mockReset());
    mock(initEasyCreditClient).mockReturnValue(client);
    mock(updatePayment).mockImplementation(async (payment) => payment);
    client.getPayment.mockResolvedValue({ status: 'AUTHORIZED', decision: { transactionId: EC_TX_ID } });
  });

  describe('handleCapturePayment', () => {
    it('captures at easyCredit and adds a pending Charge', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(method));

      await handleCapturePayment(PAYMENT_ID, 'track-1');

      expect(client.getPayment).toHaveBeenCalledWith(TECH_ID);
      expect(client.capturePayment).toHaveBeenCalledWith(EC_TX_ID, PAYMENT_ID, 'track-1');
      expect(updateActions()).toEqual([
        [
          expect.objectContaining({
            action: 'addTransaction',
            transaction: expect.objectContaining({ type: 'Charge', state: 'Pending', interactionId: EC_TX_ID }),
          }),
        ],
      ]);
    });

    it('still captures when a refund was registered before shipping', async () => {
      mock(getPaymentById).mockResolvedValue(
        buildPayment(method, [{ id: 'refund-1', type: 'Refund', state: 'Pending' }]),
      );

      await handleCapturePayment(PAYMENT_ID);

      expect(client.capturePayment).toHaveBeenCalledTimes(1);
    });

    it('passes the easyCredit error on and adds no Charge', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(method));
      client.capturePayment.mockRejectedValue(ecError);

      await expect(handleCapturePayment(PAYMENT_ID)).rejects.toBe(ecError);
      expect(updatePayment).not.toHaveBeenCalled();
      expect(log.error).toHaveBeenCalledWith('Error in capturing payment', ecError);
    });

    it('rejects a payment that easyCredit does not report as AUTHORIZED', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(method));
      client.getPayment.mockResolvedValue({ status: 'PREAUTHORIZED', decision: { transactionId: EC_TX_ID } });

      await expect(handleCapturePayment(PAYMENT_ID)).rejects.toMatchObject({ code: 'TransactionIsNotAuthorized' });
      expect(client.capturePayment).not.toHaveBeenCalled();
    });

    it.each(['Pending', 'Success'])('rejects a second capture while a Charge is %s', async (state) => {
      mock(getPaymentById).mockResolvedValue(buildPayment(method, [{ id: 'charge-1', type: 'Charge', state }]));

      await expect(handleCapturePayment(PAYMENT_ID)).rejects.toMatchObject({
        code: 'PaymentAlreadyCaptured',
        httpErrorStatus: 400,
      });
      expect(client.getPayment).not.toHaveBeenCalled();
      expect(client.capturePayment).not.toHaveBeenCalled();
    });

    it('allows a new capture after a failed one', async () => {
      mock(getPaymentById).mockResolvedValue(
        buildPayment(method, [{ id: 'charge-1', type: 'Charge', state: 'Failure' }]),
      );

      await handleCapturePayment(PAYMENT_ID);

      expect(client.capturePayment).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleRefundPayment', () => {
    it.each([
      ['partial', 25],
      ['full', 100],
    ])('sends a %s refund with the new transaction as booking and sets it Pending', async (_name, amount) => {
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

    it('uses its own booking ID while an earlier refund is still Initial', async () => {
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

    it('finds its refund when CT does not put it at the end', async () => {
      const payment = buildPayment(method, [{ id: 'refund-other', type: 'Refund', state: 'Initial' }]);
      mock(getPaymentById).mockResolvedValue(payment);
      addOnUpdate(payment, 'refund-new', 'start');

      await handleRefundPayment(PAYMENT_ID, 10);

      expect(client.refundPayment).toHaveBeenCalledWith(EC_TX_ID, { value: 10, bookingId: 'refund-new' });
    });

    it('sets the refund to Failure and passes the easyCredit error on', async () => {
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
        'Failed to mark refund transaction as failed',
        expect.objectContaining({ paymentId: PAYMENT_ID, transactionId: 'refund-new' }),
      );
    });

    it.each([0, -1, 100.01])('rejects the refund amount %s without calling easyCredit', async (amount) => {
      mock(getPaymentById).mockResolvedValue(buildPayment(method));

      await expect(handleRefundPayment(PAYMENT_ID, amount)).rejects.toMatchObject({ code: 'InvalidRefundAmount' });
      expect(client.refundPayment).not.toHaveBeenCalled();
      expect(updatePayment).not.toHaveBeenCalled();
    });
  });
});
