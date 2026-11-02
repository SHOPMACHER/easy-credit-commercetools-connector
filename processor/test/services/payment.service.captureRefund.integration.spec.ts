import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Errorx, Payment } from '@commercetools/connect-payments-sdk';
import { handleCapturePayment, handleRefundPayment } from '../../src/services/payment.service';
import { handleEasyCreditNotification } from '../../src/services/easycreditNotification.service';

// A short request timeout, so the real AbortSignal of the client fires within the test.
jest.mock('../../src/utils/constant.utils', () => ({
  ...jest.requireActual<object>('../../src/utils/constant.utils'),
  EASYCREDIT_REQUEST_TIMEOUT_MS: 50,
}));

// Writable shapes, as the fake mutates what the SDK types declare read-only.
type StoredTransaction = Record<string, any>;
type StoredPayment = { id: string; version: number; transactions: StoredTransaction[] } & Record<string, any>;

// commercetools in memory: version-locked updates that apply the transaction actions like the API does.
const mockStore = new Map<string, StoredPayment>();
let mockNextId = 0;

jest.mock('../../src/commercetools/payment.commercetools', () => {
  const clone = <T>(value: T): T => structuredClone(value);
  const find = (id: string) => mockStore.get(id) as StoredPayment;

  return {
    getPaymentById: async (id: string) => clone(find(id)),
    getPaymentByEasyCreditRefundBookingId: async (bookingId: string) =>
      clone([...mockStore.values()].find(({ transactions }) => transactions.some(({ id }) => id === bookingId))),
    updatePayment: async (payment: Payment, actions: Record<string, any>[]) => {
      const current = find(payment.id);
      if (current.version !== payment.version) {
        throw new Errorx({ code: 'ConcurrentModification', message: 'Version mismatch', httpErrorStatus: 409 });
      }
      for (const action of actions) {
        if (action.action === 'addTransaction') {
          const { amount, ...draft } = action.transaction;
          current.transactions.push({
            id: `tx-${++mockNextId}`,
            ...draft,
            amount: { type: 'centPrecision', fractionDigits: 2, ...amount },
          });
        } else if (action.action === 'changeTransactionState') {
          const transaction = current.transactions.find(({ id }) => id === action.transactionId) as StoredTransaction;
          transaction.state = action.state;
        } else {
          throw new Error(`Unexpected action ${action.action}`);
        }
      }
      current.version += 1;
      return clone(current);
    },
  };
});

const PAYMENT_ID = 'payment-1';
const EC_TX_ID = 'ABC123';
const TECH_ID = 'tech-1';

// easyCredit behind fetch: the client, its error handling and its timeouts stay real.
let bookings: Record<string, unknown>[];
let answerCapture: (init: RequestInit) => Promise<Response>;
let answerRefund: (init: RequestInit) => Promise<Response>;

const accepted = async () => new Response(null, { status: 202 });
const hang = (init: RequestInit) =>
  new Promise<Response>((_resolve, reject) =>
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
  );

const fakeEasyCredit = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
  const url = String(input);
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  if (url.endsWith(`/payment/v3/transaction/${TECH_ID}`)) {
    return json({ status: 'AUTHORIZED', decision: { transactionId: EC_TX_ID } });
  }
  if (url.endsWith(`/merchant/v3/transaction/${EC_TX_ID}/capture`)) {
    return answerCapture(init);
  }
  if (url.endsWith(`/merchant/v3/transaction/${EC_TX_ID}/refund`)) {
    return answerRefund(init);
  }
  if (url.endsWith(`/merchant/v3/transaction/${EC_TX_ID}`)) {
    return json({ transactionId: EC_TX_ID, status: 'AUTHORIZED', bookings, orderDetails: { orderId: PAYMENT_ID } });
  }
  throw new Error(`Unexpected request ${init.method ?? 'GET'} ${url}`);
};

const captureBooking = (status: string, created: string) => ({
  bookingType: 'ApiBooking',
  type: 'CAPTURE',
  uuid: `capture-${created}`,
  created,
  status,
});

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString();
const stored = () => mockStore.get(PAYMENT_ID) as StoredPayment;
const charges = () => stored().transactions.filter(({ type }) => type === 'Charge');
const refunds = () => stored().transactions.filter(({ type }) => type === 'Refund');
const requests = (path: string) =>
  jest.mocked(fetch).mock.calls.filter(([url, init]) => init?.method === 'POST' && String(url).endsWith(path));

const seed = (...transactions: StoredTransaction[]) =>
  mockStore.set(PAYMENT_ID, {
    id: PAYMENT_ID,
    version: 1,
    amountPlanned: { type: 'centPrecision', centAmount: 10000, currencyCode: 'EUR', fractionDigits: 2 },
    paymentMethodInfo: { paymentInterface: 'easycredit', method: 'easycredit' },
    transactions: [
      {
        id: 'auth-1',
        type: 'Authorization',
        state: 'Success',
        interactionId: EC_TX_ID,
        amount: { type: 'centPrecision', centAmount: 10000, currencyCode: 'EUR', fractionDigits: 2 },
        custom: { type: { typeId: 'type', id: 'type-1' }, fields: { easyCreditTechnicalTransactionId: TECH_ID } },
      },
      ...transactions,
    ],
  });

describe('capture and refund against commercetools and easyCredit fakes', () => {
  beforeEach(() => {
    mockStore.clear();
    bookings = [];
    answerCapture = accepted;
    answerRefund = accepted;
    jest.spyOn(global, 'fetch').mockImplementation(fakeEasyCredit);
    seed();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('a Pending Charge that no notification completes', () => {
    it('is captured again once it is stale and easyCredit has no booking for it', async () => {
      await handleCapturePayment(PAYMENT_ID);
      // The notification never comes and easyCredit lists no booking.
      charges()[0].timestamp = minutesAgo(16);

      await handleCapturePayment(PAYMENT_ID);

      expect(charges().map(({ state }) => state)).toEqual(['Failure', 'Pending']);
      expect(requests('/capture')).toHaveLength(2);
    });

    it('is not captured again while it is recent', async () => {
      await handleCapturePayment(PAYMENT_ID);
      await handleCapturePayment(PAYMENT_ID);

      expect(charges().map(({ state }) => state)).toEqual(['Pending']);
      expect(requests('/capture')).toHaveLength(1);
    });

    it('is completed from a DONE booking without capturing again', async () => {
      await handleCapturePayment(PAYMENT_ID);
      bookings = [captureBooking('DONE', new Date().toISOString())];

      await handleCapturePayment(PAYMENT_ID);

      expect(charges().map(({ state }) => state)).toEqual(['Success']);
      expect(requests('/capture')).toHaveLength(1);
    });

    it('left by a crash before easyCredit was called is captured again', async () => {
      seed({
        id: 'charge-crashed',
        type: 'Charge',
        state: 'Pending',
        interactionId: EC_TX_ID,
        timestamp: minutesAgo(60),
      });

      await handleCapturePayment(PAYMENT_ID);

      expect(charges().map(({ state }) => state)).toEqual(['Failure', 'Pending']);
      expect(requests('/capture')).toHaveLength(1);
    });
  });

  it('keeps a retried Charge Pending when a notification still lists the FAILED booking of the earlier capture', async () => {
    seed({ id: 'charge-old', type: 'Charge', state: 'Failure', interactionId: EC_TX_ID, timestamp: minutesAgo(30) });
    bookings = [captureBooking('FAILED', minutesAgo(30))];

    await handleCapturePayment(PAYMENT_ID);
    await handleEasyCreditNotification(EC_TX_ID);

    expect(charges().map(({ state }) => state)).toEqual(['Failure', 'Pending']);

    bookings = [...bookings, captureBooking('DONE', new Date().toISOString())];
    await handleEasyCreditNotification(EC_TX_ID);

    expect(charges().map(({ state }) => state)).toEqual(['Failure', 'Success']);
  });

  it('sets the Charge to Failure and answers 504 when the capture request times out', async () => {
    answerCapture = hang;

    await expect(handleCapturePayment(PAYMENT_ID)).rejects.toMatchObject({
      code: 'CaptureFailed',
      httpErrorStatus: 504,
    });
    expect(charges().map(({ state }) => state)).toEqual(['Failure']);
  });

  it('keeps the refund Pending when the refund request times out', async () => {
    answerRefund = hang;

    const result = await handleRefundPayment(PAYMENT_ID, 25.5);

    expect(refunds()).toEqual([
      expect.objectContaining({ state: 'Pending', amount: expect.objectContaining({ centAmount: 2550 }) }),
    ]);
    expect(result.transactions.find(({ type }) => type === 'Refund')?.state).toBe('Pending');
    expect(JSON.parse(requests('/refund')[0][1]?.body as string)).toEqual({ value: 25.5, bookingId: refunds()[0].id });
  });

  it('refunds only the amount that is left, also for parallel requests', async () => {
    await handleRefundPayment(PAYMENT_ID, 30);

    const results = await Promise.allSettled([
      handleRefundPayment(PAYMENT_ID, 60),
      handleRefundPayment(PAYMENT_ID, 60),
    ]);

    // The second request read the same version, so its Refund is not added and easyCredit is not called.
    expect(results.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(requests('/refund')).toHaveLength(2);
    await expect(handleRefundPayment(PAYMENT_ID, 10.01)).rejects.toMatchObject({ code: 'InvalidRefundAmount' });
    await expect(handleRefundPayment(PAYMENT_ID, 10)).resolves.toBeDefined();
  });
});
