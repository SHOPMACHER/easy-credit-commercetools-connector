import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { handleCapturePayment, handleRefundPayment } from '../../src/services/payment.service';
import { handleEasyCreditNotification } from '../../src/services/easycreditNotification.service';
import {
  EASYCREDIT_EARLIER_CAPTURE_BOOKINGS_FIELD,
  EASYCREDIT_INTEREST_FIELD,
  EASYCREDIT_TECHNICAL_TRANSACTION_ID_FIELD,
  EASYCREDIT_TOTAL_VALUE_FIELD,
} from '../../src/utils/constant.utils';

// A short request timeout, so the real AbortSignal of the client fires within the test.
jest.mock('../../src/utils/constant.utils', () => ({
  ...jest.requireActual<object>('../../src/utils/constant.utils'),
  EASYCREDIT_REQUEST_TIMEOUT_MS: 50,
}));

// Both APIs are faked behind fetch only: the commercetools SDK client, the payment module,
// the easyCredit client and their error handling run as in production.
type StoredTransaction = Record<string, any>;
type StoredPayment = { id: string; version: number; transactions: StoredTransaction[] } & Record<string, any>;

const PROJECT_KEY = process.env.CTP_PROJECT_KEY as string;
const PAYMENT_ID = 'payment-1';
const EC_TX_ID = 'ABC123';
const TECH_ID = 'tech-1';
const TRANSACTION_FIELDS = new Set([
  EASYCREDIT_TECHNICAL_TRANSACTION_ID_FIELD,
  EASYCREDIT_INTEREST_FIELD,
  EASYCREDIT_TOTAL_VALUE_FIELD,
  EASYCREDIT_EARLIER_CAPTURE_BOOKINGS_FIELD,
]);

const store = new Map<string, StoredPayment>();
let nextId = 0;
let bookings: Record<string, unknown>[] | undefined;
let ecStatus: string;
let answerCapture: (init: RequestInit) => Promise<Response>;
let answerRefund: (init: RequestInit) => Promise<Response>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ctError = (status: number, code: string, message: string) =>
  json({ statusCode: status, message, errors: [{ code, message }] }, status);
const accepted = async () => new Response(null, { status: 202 });
const hang = (init: RequestInit) =>
  new Promise<Response>((_resolve, reject) =>
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
  );

// The update actions this flow sends, applied like the API does, with its version lock and custom field check.
const applyAction = (payment: StoredPayment, action: Record<string, any>): Response | undefined => {
  if (action.action === 'addTransaction') {
    const { amount, custom, ...draft } = action.transaction;
    const unknownField = Object.keys(custom?.fields ?? {}).find((name) => !TRANSACTION_FIELDS.has(name));
    if (unknownField) {
      return ctError(400, 'InvalidInput', `The field '${unknownField}' is not defined`);
    }
    payment.transactions.push({
      id: `tx-${++nextId}`,
      ...draft,
      amount: { type: 'centPrecision', fractionDigits: 2, ...amount },
      ...(custom && { custom: { type: { typeId: 'type', id: 'type-1' }, fields: custom.fields } }),
    });
    return undefined;
  }
  if (action.action === 'changeTransactionState') {
    const transaction = payment.transactions.find(({ id }) => id === action.transactionId) as StoredTransaction;
    transaction.state = action.state;
    return undefined;
  }
  return ctError(400, 'InvalidInput', `Unexpected action ${action.action}`);
};

const fakeCommercetools = async (url: URL, init: RequestInit): Promise<Response> => {
  if (url.pathname === '/oauth/token') {
    return json({ access_token: 'token', token_type: 'Bearer', expires_in: 172800 });
  }
  const byId = new RegExp(`^/${PROJECT_KEY}/payments/([^/]+)$`).exec(url.pathname);
  if (byId) {
    const stored = store.get(byId[1]);
    if (!stored) {
      return ctError(404, 'ResourceNotFound', `The Resource with ID '${byId[1]}' was not found.`);
    }
    if (init.method !== 'POST') {
      return json(stored);
    }
    const { version, actions } = JSON.parse(init.body as string);
    if (version !== stored.version) {
      return ctError(409, 'ConcurrentModification', `Expected version ${version}, actual ${stored.version}.`);
    }
    const updated = structuredClone(stored);
    for (const action of actions) {
      const rejected = applyAction(updated, action);
      if (rejected) {
        return rejected;
      }
    }
    updated.version += 1;
    store.set(updated.id, updated);
    return json(updated);
  }
  if (url.pathname === `/${PROJECT_KEY}/payments`) {
    const transactionId = /transactions\(id="(.+)"\)/.exec(url.searchParams.get('where') ?? '')?.[1];
    const results = [...store.values()].filter(({ transactions }) =>
      transactions.some(({ id }) => id === transactionId),
    );
    return json({ limit: 20, offset: 0, count: results.length, results });
  }
  throw new Error(`Unexpected commercetools request ${init.method ?? 'GET'} ${url}`);
};

const fakeEasyCredit = async (url: URL, init: RequestInit): Promise<Response> => {
  if (url.pathname.endsWith(`/payment/v3/transaction/${TECH_ID}`)) {
    return json({ status: 'AUTHORIZED', decision: { transactionId: EC_TX_ID } });
  }
  if (url.pathname.endsWith(`/merchant/v3/transaction/${EC_TX_ID}/capture`)) {
    return answerCapture(init);
  }
  if (url.pathname.endsWith(`/merchant/v3/transaction/${EC_TX_ID}/refund`)) {
    return answerRefund(init);
  }
  if (url.pathname.endsWith(`/merchant/v3/transaction/${EC_TX_ID}`)) {
    return json({ transactionId: EC_TX_ID, status: ecStatus, bookings, orderDetails: { orderId: PAYMENT_ID } });
  }
  throw new Error(`Unexpected easyCredit request ${init.method ?? 'GET'} ${url}`);
};

const fakeFetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
  const url = new URL(String(input));
  return url.host.includes('commercetools') ? fakeCommercetools(url, init) : fakeEasyCredit(url, init);
};

const captureBooking = (status: string, created: string, uuid = `capture-${status}-${created}`) => ({
  bookingType: 'ApiBooking',
  type: 'CAPTURE',
  uuid,
  created,
  status,
});
const refundBooking = (bookingId: string, status: string) => ({
  bookingType: 'RefundBooking',
  type: 'REFUND',
  uuid: `refund-${bookingId}-${status}`,
  created: new Date().toISOString(),
  status,
  bookingId,
});

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString();
const stored = () => store.get(PAYMENT_ID) as StoredPayment;
const charges = () => stored().transactions.filter(({ type }) => type === 'Charge');
const refunds = () => stored().transactions.filter(({ type }) => type === 'Refund');
let fetchSpy: jest.SpiedFunction<typeof fetch>;
const requests = (path: string) =>
  fetchSpy.mock.calls.filter(([url, init]) => init?.method === 'POST' && String(url).endsWith(path));

const seed = (...transactions: StoredTransaction[]) =>
  store.set(PAYMENT_ID, {
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

describe('capture and refund against the commercetools and easyCredit APIs behind fetch', () => {
  beforeAll(() => {
    // Installed once, as the commercetools client keeps the fetch it was built with.
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(fakeFetch);
  });

  afterAll(() => {
    fetchSpy.mockRestore();
  });

  beforeEach(() => {
    fetchSpy.mockClear();
    store.clear();
    bookings = [];
    ecStatus = 'REPORT_CAPTURE';
    answerCapture = accepted;
    answerRefund = accepted;
    seed();
  });

  describe('a Pending Charge that no notification completes', () => {
    it('is captured again when easyCredit never received its capture', async () => {
      // Left by a crash between adding the Charge and calling easyCredit.
      seed({
        id: 'charge-crashed',
        type: 'Charge',
        state: 'Pending',
        interactionId: EC_TX_ID,
        timestamp: minutesAgo(1),
      });

      await handleCapturePayment(PAYMENT_ID);

      expect(charges().map(({ state }) => state)).toEqual(['Failure', 'Pending']);
      expect(requests('/capture')).toHaveLength(1);
    });

    it('is not captured again while easyCredit has not listed the booking of a capture just sent', async () => {
      await handleCapturePayment(PAYMENT_ID);
      await handleCapturePayment(PAYMENT_ID);

      expect(charges().map(({ state }) => state)).toEqual(['Pending']);
      expect(requests('/capture')).toHaveLength(1);
    });

    it('stays Pending, however old, while its capture booking is PENDING', async () => {
      seed({ id: 'charge-1', type: 'Charge', state: 'Pending', interactionId: EC_TX_ID, timestamp: minutesAgo(600) });
      // easyCredit keeps REPORT_CAPTURE until the booking is DONE.
      ecStatus = 'REPORT_CAPTURE';
      bookings = [captureBooking('PENDING', minutesAgo(599))];

      await handleCapturePayment(PAYMENT_ID);

      expect(charges().map(({ state }) => state)).toEqual(['Pending']);
      expect(requests('/capture')).toHaveLength(0);
    });

    it('is completed from a DONE booking without capturing again', async () => {
      await handleCapturePayment(PAYMENT_ID);
      bookings = [captureBooking('DONE', new Date().toISOString())];

      await handleCapturePayment(PAYMENT_ID);

      expect(charges().map(({ state }) => state)).toEqual(['Success']);
      expect(requests('/capture')).toHaveLength(1);
    });

    it('stays Pending when easyCredit sends the transaction without bookings', async () => {
      seed({ id: 'charge-1', type: 'Charge', state: 'Pending', interactionId: EC_TX_ID, timestamp: minutesAgo(600) });
      bookings = undefined;

      await handleCapturePayment(PAYMENT_ID);
      await handleEasyCreditNotification(EC_TX_ID);

      expect(charges().map(({ state }) => state)).toEqual(['Pending']);
      expect(requests('/capture')).toHaveLength(0);
    });
  });

  it('sends one capture for parallel requests', async () => {
    await Promise.all([handleCapturePayment(PAYMENT_ID), handleCapturePayment(PAYMENT_ID)]);

    expect(charges().map(({ state }) => state)).toEqual(['Pending']);
    expect(requests('/capture')).toHaveLength(1);
  });

  describe('a capture retried right after a FAILED booking', () => {
    // Dated just before the retry, so a clock tolerance would take it as the result of the retry.
    const failed = captureBooking('FAILED', new Date(Date.now() - 30000).toISOString(), 'capture-failed');

    beforeEach(() => {
      seed({ id: 'charge-old', type: 'Charge', state: 'Failure', interactionId: EC_TX_ID, timestamp: minutesAgo(1) });
      ecStatus = 'REPORT_CAPTURE_FAILED';
      bookings = [failed];
    });

    it('stores the FAILED booking on the new Charge, so a notification keeps the Charge Pending', async () => {
      await handleCapturePayment(PAYMENT_ID);
      await handleEasyCreditNotification(EC_TX_ID);

      expect(charges().map(({ state }) => state)).toEqual(['Failure', 'Pending']);
      expect(charges()[1].custom.fields).toEqual({
        easyCreditTechnicalTransactionId: TECH_ID,
        easyCreditEarlierCaptureBookings: ['capture-failed'],
      });

      bookings = [failed, captureBooking('DONE', new Date().toISOString())];
      await handleEasyCreditNotification(EC_TX_ID);

      expect(charges().map(({ state }) => state)).toEqual(['Failure', 'Success']);
    });

    it('does not send the capture twice when the request is repeated before the new booking is listed', async () => {
      await handleCapturePayment(PAYMENT_ID);
      await handleCapturePayment(PAYMENT_ID);

      expect(charges().map(({ state }) => state)).toEqual(['Failure', 'Pending']);
      expect(requests('/capture')).toHaveLength(1);
    });

    it('fails the new Charge for its own FAILED booking', async () => {
      await handleCapturePayment(PAYMENT_ID);
      bookings = [failed, captureBooking('FAILED', new Date().toISOString(), 'capture-failed-again')];

      await handleEasyCreditNotification(EC_TX_ID);

      expect(charges().map(({ state }) => state)).toEqual(['Failure', 'Failure']);
    });
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

  describe('a refund that no notification completes', () => {
    it('stays Pending and keeps its amount, however old, while easyCredit has no booking for it', async () => {
      answerRefund = hang;
      await handleRefundPayment(PAYMENT_ID, 100);
      refunds()[0].timestamp = minutesAgo(600);
      answerRefund = accepted;

      await expect(handleRefundPayment(PAYMENT_ID, 100)).rejects.toMatchObject({ code: 'InvalidRefundAmount' });
      await handleEasyCreditNotification(EC_TX_ID);
      await handleCapturePayment(PAYMENT_ID);

      expect(refunds().map(({ state }) => state)).toEqual(['Pending']);
      expect(requests('/refund')).toHaveLength(1);
    });

    it('is completed when its booking turns up late', async () => {
      answerRefund = hang;
      await handleRefundPayment(PAYMENT_ID, 100);
      bookings = [refundBooking(refunds()[0].id, 'DONE')];

      await handleEasyCreditNotification(EC_TX_ID);

      expect(refunds().map(({ state }) => state)).toEqual(['Success']);
    });

    it('frees its amount once easyCredit failed it', async () => {
      await handleRefundPayment(PAYMENT_ID, 100);
      bookings = [refundBooking(refunds()[0].id, 'FAILED')];

      await handleRefundPayment(PAYMENT_ID, 100);

      expect(refunds().map(({ state }) => state)).toEqual(['Failure', 'Pending']);
      expect(requests('/refund')).toHaveLength(2);
    });

    it('is completed from its booking by a capture request', async () => {
      await handleRefundPayment(PAYMENT_ID, 30);
      bookings = [refundBooking(refunds()[0].id, 'DONE')];

      await handleCapturePayment(PAYMENT_ID);

      expect(refunds().map(({ state }) => state)).toEqual(['Success']);
      expect(charges().map(({ state }) => state)).toEqual(['Pending']);
    });

    it('stays Pending while its booking is open', async () => {
      await handleRefundPayment(PAYMENT_ID, 30);
      bookings = [refundBooking(refunds()[0].id, 'PENDING')];

      await expect(handleRefundPayment(PAYMENT_ID, 70.01)).rejects.toMatchObject({ code: 'InvalidRefundAmount' });

      expect(refunds().map(({ state }) => state)).toEqual(['Pending']);
    });
  });

  describe('a notification', () => {
    it('answers without reading or writing a payment when easyCredit has no completed booking', async () => {
      store.clear();
      fetchSpy.mockClear();

      await expect(handleEasyCreditNotification(EC_TX_ID)).resolves.toBeUndefined();

      expect(fetchSpy.mock.calls.map(([url]) => new URL(String(url)).host)).not.toContainEqual(
        expect.stringContaining('commercetools'),
      );
    });

    it('does not touch open refunds without a completed booking', async () => {
      await handleRefundPayment(PAYMENT_ID, 30);
      const version = stored().version;

      await handleEasyCreditNotification(EC_TX_ID);

      expect(stored().version).toBe(version);
    });
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
