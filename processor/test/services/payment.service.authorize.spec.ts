import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Errorx } from '@commercetools/connect-payments-sdk';
import { handleAuthorizeECPayment, handleAuthorizePayment, handleGetPayment } from '../../src/services/payment.service';
import { getCartByPaymentId, updateCart } from '../../src/commercetools/cart.commercetools';
import { getPaymentById, updatePayment } from '../../src/commercetools/payment.commercetools';
import { initEasyCreditClient } from '../../src/client/easycredit.client';
import { log } from '../../src/libs/logger';

jest.mock('../../src/commercetools/cart.commercetools');
jest.mock('../../src/commercetools/payment.commercetools');
jest.mock('../../src/client/easycredit.client');
jest.mock('../../src/libs/logger');
jest.mock('../../src/utils/map.utils');
jest.mock('../../src/services/webshop.service');
jest.mock('../../src/utils/config.utils', () => ({
  readConfiguration: jest.fn(() => ({
    easyCredit: { webShopId: 'webShopId123' },
    commerceTools: { projectKey: 'projectKey123', clientId: 'clientId123', clientSecret: 'clientSecret', region: 'eu' },
  })),
}));

type AnyFn = (...args: any[]) => any;
const mock = (fn: unknown) => fn as jest.Mock<AnyFn>;

const PAYMENT_ID = 'payment-1';
const TX_ID = 'tx-1';
const TECH_ID = 'tech-1';

type TestCart = {
  id: string;
  cartState: string;
  totalPrice: { centAmount: number; currencyCode: string; fractionDigits: number };
};

// Stateful commercetools fake: the payment is rebuilt from these on every read.
let ctState: string;
let ctVersion: number;
let ctMethod: string;
let defaultMethod = 'INSTALLMENT_PAYMENT';
let txCents: number;
let cart: TestCart;

const client = { getPayment: jest.fn<AnyFn>(), authorizePayment: jest.fn<AnyFn>() };

const buildPayment = () => ({
  id: PAYMENT_ID,
  version: ctVersion,
  paymentMethodInfo: { paymentInterface: 'easycredit', method: ctMethod },
  transactions: [
    {
      id: TX_ID,
      type: 'Authorization',
      state: ctState,
      interactionId: 'ec-tx-1',
      amount: { centAmount: txCents, currencyCode: 'EUR', fractionDigits: 2 },
      custom: { fields: { easyCreditTechnicalTransactionId: TECH_ID } },
    },
  ],
});

const buildCart = (cartState = 'Frozen', centAmount = 10000): TestCart => ({
  id: 'cart-1',
  cartState,
  totalPrice: { centAmount, currencyCode: 'EUR', fractionDigits: 2 },
});

const ec = (status: string, orderValue = 100) => ({
  status,
  decision: { transactionId: 'ec-tx-1', orderValue, decisionOutcome: 'POSITIVE' },
  transaction: { financingTerm: 12, orderDetails: { orderValue, orderId: PAYMENT_ID } },
});

const setup = (opts: { state?: string; method?: string; txCents?: number; cart?: TestCart } = {}) => {
  ctState = opts.state ?? 'Initial';
  ctVersion = 1;
  ctMethod = opts.method ?? defaultMethod;
  txCents = opts.txCents ?? 10000;
  cart = opts.cart ?? buildCart();
};

const writes = () => mock(updatePayment).mock.calls.map((c) => c[1][0].state);

// Runs the promise while advancing the fake clock, returns the rejection (or undefined).
const settle = async (promise: Promise<unknown>, ms = 60000) => {
  const result = promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  await jest.advanceTimersByTimeAsync(ms);
  return result;
};

beforeEach(() => {
  jest.useFakeTimers();
  mock(getPaymentById)
    .mockReset()
    .mockImplementation(async () => buildPayment());
  mock(updatePayment)
    .mockReset()
    .mockImplementation(async (_p, actions) => {
      ctState = actions[0].state;
      ctVersion += 1;
      return buildPayment();
    });
  mock(getCartByPaymentId)
    .mockReset()
    .mockImplementation(async () => cart);
  mock(updateCart).mockReset().mockResolvedValue({});
  client.getPayment.mockReset();
  client.authorizePayment.mockReset().mockResolvedValue(true);
  mock(initEasyCreditClient).mockReset().mockReturnValue(client);
  setup();
});

afterEach(() => {
  jest.useRealTimers();
});

describe.each(['INSTALLMENT_PAYMENT', 'BILL_PAYMENT'])('payment type %s', (method) => {
  beforeEach(() => {
    defaultMethod = method;
    setup();
  });

  afterEach(() => {
    defaultMethod = 'INSTALLMENT_PAYMENT';
  });

  describe('handleAuthorizeECPayment', () => {
    describe('entry states', () => {
      it('is idempotent when the transaction is already Success', async () => {
        setup({ state: 'Success' });

        await expect(handleAuthorizeECPayment(PAYMENT_ID)).resolves.toBeUndefined();

        expect(client.getPayment).not.toHaveBeenCalled();
        expect(client.authorizePayment).not.toHaveBeenCalled();
        expect(updatePayment).not.toHaveBeenCalled();
        expect(updateCart).not.toHaveBeenCalled();
      });

      it('throws TransactionNotPreauthorized for a Failure transaction without calling easyCredit', async () => {
        setup({ state: 'Failure' });

        await expect(handleAuthorizeECPayment(PAYMENT_ID)).rejects.toMatchObject({
          code: 'TransactionNotPreauthorized',
          httpErrorStatus: 400,
        });

        expect(client.getPayment).not.toHaveBeenCalled();
        expect(updatePayment).not.toHaveBeenCalled();
      });

      it.each(['OPEN', 'SOMETHING_NEW'])(
        'throws TransactionNotPreauthorized when easyCredit says %s',
        async (status) => {
          client.getPayment.mockResolvedValue(ec(status));

          await expect(handleAuthorizeECPayment(PAYMENT_ID)).rejects.toMatchObject({
            code: 'TransactionNotPreauthorized',
            httpErrorStatus: 400,
          });

          expect(client.authorizePayment).not.toHaveBeenCalled();
          expect(updatePayment).not.toHaveBeenCalled();
        },
      );

      it.each(['Initial', 'Pending'])(
        'finalizes to Success without POST when easyCredit is AUTHORIZED (%s)',
        async (state) => {
          setup({ state });
          client.getPayment.mockResolvedValue(ec('AUTHORIZED'));

          await handleAuthorizeECPayment(PAYMENT_ID);

          expect(client.getPayment).toHaveBeenCalledWith(TECH_ID, expect.any(AbortSignal));
          expect(client.authorizePayment).not.toHaveBeenCalled();
          expect(writes()).toEqual(['Success']);
        },
      );

      it.each(['DECLINED', 'EXPIRED'])('fails the transaction, unfreezes the cart and throws on %s', async (status) => {
        client.getPayment.mockResolvedValue(ec(status));

        await expect(handleAuthorizeECPayment(PAYMENT_ID)).rejects.toMatchObject({
          code: 'TransactionNotAuthorized',
          httpErrorStatus: 400,
        });

        expect(client.authorizePayment).not.toHaveBeenCalled();
        expect(writes()).toEqual(['Failure']);
        expect(updateCart).toHaveBeenCalledWith(cart, [{ action: 'unfreezeCart' }]);
      });

      it('does not unfreeze a cart that is not frozen when failing', async () => {
        setup({ cart: buildCart('Active') });
        client.getPayment.mockResolvedValue(ec('DECLINED'));

        await expect(handleAuthorizeECPayment(PAYMENT_ID)).rejects.toMatchObject({ code: 'TransactionNotAuthorized' });

        expect(writes()).toEqual(['Failure']);
        expect(updateCart).not.toHaveBeenCalled();
      });

      it('lets the original error win when unfreezing the cart fails', async () => {
        mock(updateCart).mockRejectedValue(new Error('unfreeze failed'));
        client.getPayment.mockResolvedValue(ec('DECLINED'));

        await expect(handleAuthorizeECPayment(PAYMENT_ID)).rejects.toMatchObject({
          code: 'TransactionNotAuthorized',
          httpErrorStatus: 400,
        });

        expect(writes()).toEqual(['Failure']);
      });
    });

    describe('initial authorization (Initial + PREAUTHORIZED)', () => {
      it('checks the amount, POSTs once, writes Pending, then polls', async () => {
        client.getPayment
          .mockResolvedValueOnce(ec('PREAUTHORIZED'))
          .mockResolvedValueOnce(ec('PREAUTHORIZED'))
          .mockResolvedValue(ec('AUTHORIZED'));

        const err = await settle(handleAuthorizeECPayment(PAYMENT_ID));

        expect(err).toBeUndefined();
        expect(client.authorizePayment).toHaveBeenCalledTimes(1);
        expect(client.authorizePayment).toHaveBeenCalledWith(TECH_ID, PAYMENT_ID, expect.any(AbortSignal));
        expect(writes()).toEqual(['Pending', 'Success']);
        expect(mock(client.authorizePayment).mock.invocationCallOrder[0]).toBeLessThan(
          mock(updatePayment).mock.invocationCallOrder[0],
        );
        expect(updateCart).not.toHaveBeenCalled();
      });

      it('passes an abort signal with the remaining budget, computed at call time, to the POST', async () => {
        mock(getCartByPaymentId).mockImplementation(async () => {
          jest.setSystemTime(Date.now() + 1500); // time spent before the POST
          return cart;
        });
        const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
        try {
          client.getPayment.mockResolvedValueOnce(ec('PREAUTHORIZED')).mockResolvedValue(ec('AUTHORIZED'));

          const err = await settle(handleAuthorizeECPayment(PAYMENT_ID));

          expect(err).toBeUndefined();
          expect(client.getPayment.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
          expect(client.authorizePayment.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
          expect(timeoutSpy.mock.calls[0]).toEqual([30000]);
          expect(timeoutSpy.mock.calls[1]).toEqual([28500]);
        } finally {
          timeoutSpy.mockRestore();
        }
      });

      it('throws AuthorizationTimeout (504) without POSTing when the budget is used up before the POST', async () => {
        mock(getCartByPaymentId).mockImplementation(async () => {
          jest.setSystemTime(Date.now() + 30000);
          return cart;
        });
        client.getPayment.mockResolvedValue(ec('PREAUTHORIZED'));

        await expect(handleAuthorizeECPayment(PAYMENT_ID)).rejects.toMatchObject({
          code: 'AuthorizationTimeout',
          httpErrorStatus: 504,
        });

        expect(client.authorizePayment).not.toHaveBeenCalled();
        expect(updatePayment).not.toHaveBeenCalled();
        expect(updateCart).not.toHaveBeenCalled();
        expect(ctState).toBe('Initial');
      });

      it('does not write Success in the pre-POST amount check', async () => {
        client.getPayment.mockResolvedValue(ec('PREAUTHORIZED'));

        await settle(handleAuthorizeECPayment(PAYMENT_ID));

        expect(writes()).toEqual(['Pending']);
      });

      it('propagates a POST error unchanged and leaves the transaction Initial', async () => {
        const postError = new Errorx({
          code: 'AuthorizationFailed',
          message: 'Authorization failed',
          httpErrorStatus: 502,
        });
        client.getPayment.mockResolvedValue(ec('PREAUTHORIZED'));
        client.authorizePayment.mockRejectedValue(postError);

        await expect(handleAuthorizeECPayment(PAYMENT_ID)).rejects.toBe(postError);

        expect(updatePayment).not.toHaveBeenCalled();
        expect(updateCart).not.toHaveBeenCalled();
        expect(ctState).toBe('Initial');
      });

      it.each([
        ['EC value differs from cart and transaction', 10000, 10000, 'Frozen', 99.99],
        ['cart total differs', 10001, 10000, 'Frozen', 100],
        ['transaction amount differs', 10000, 9999, 'Frozen', 100],
        ['cart is Active', 10000, 10000, 'Active', 100],
        ['cart is Ordered', 10000, 10000, 'Ordered', 100],
      ])('fails with AmountMismatch and never POSTs when %s', async (_name, cartCents, tCents, cartState, ecValue) => {
        setup({ txCents: tCents, cart: buildCart(cartState, cartCents) });
        client.getPayment.mockResolvedValue(ec('PREAUTHORIZED', ecValue));

        await expect(handleAuthorizeECPayment(PAYMENT_ID)).rejects.toMatchObject({
          code: 'AmountMismatch',
          httpErrorStatus: 400,
        });

        expect(client.authorizePayment).not.toHaveBeenCalled();
        expect(writes()).toEqual(['Failure']);
        if (cartState === 'Frozen') {
          expect(updateCart).toHaveBeenCalledWith(cart, [{ action: 'unfreezeCart' }]);
        } else {
          expect(updateCart).not.toHaveBeenCalled();
        }
      });
    });

    describe('amount check', () => {
      it('matches 19.99 EUR against 1999 cents (floating point rounding)', async () => {
        setup({ state: 'Pending', txCents: 1999, cart: buildCart('Frozen', 1999) });
        client.getPayment.mockResolvedValue(ec('AUTHORIZED', 19.99));

        await handleAuthorizeECPayment(PAYMENT_ID);

        expect(writes()).toEqual(['Success']);
      });

      it('rejects 19.98 EUR against 1999 cents', async () => {
        setup({ state: 'Pending', txCents: 1999, cart: buildCart('Frozen', 1999) });
        client.getPayment.mockResolvedValue(ec('AUTHORIZED', 19.98));

        await expect(handleAuthorizeECPayment(PAYMENT_ID)).rejects.toMatchObject({ code: 'AmountMismatch' });

        expect(writes()).toEqual(['Failure']);
      });

      it('prefers transaction.orderDetails.orderValue over decision.orderValue', async () => {
        setup({ state: 'Pending' });
        const response = ec('AUTHORIZED', 100);
        response.decision.orderValue = 1;
        client.getPayment.mockResolvedValue(response);

        await handleAuthorizeECPayment(PAYMENT_ID);

        expect(writes()).toEqual(['Success']);
      });

      it('falls back to decision.orderValue when transaction.orderDetails is missing', async () => {
        setup({ state: 'Pending' });
        client.getPayment.mockResolvedValue({
          status: 'AUTHORIZED',
          decision: { transactionId: 'ec-tx-1', orderValue: 100, decisionOutcome: 'POSITIVE' },
        });

        await handleAuthorizeECPayment(PAYMENT_ID);

        expect(writes()).toEqual(['Success']);
      });

      it('fails with AmountMismatch when no order value can be determined', async () => {
        setup({ state: 'Pending' });
        client.getPayment.mockResolvedValue({ status: 'AUTHORIZED' });

        await expect(handleAuthorizeECPayment(PAYMENT_ID)).rejects.toMatchObject({
          code: 'AmountMismatch',
          httpErrorStatus: 400,
        });

        expect(writes()).toEqual(['Failure']);
        expect(updateCart).toHaveBeenCalledWith(cart, [{ action: 'unfreezeCart' }]);
      });

      it('fails with AmountMismatch when the cart is not Frozen at AUTHORIZED time and skips unfreeze', async () => {
        setup({ state: 'Pending', cart: buildCart('Active') });
        client.getPayment.mockResolvedValue(ec('AUTHORIZED'));

        await expect(handleAuthorizeECPayment(PAYMENT_ID)).rejects.toMatchObject({ code: 'AmountMismatch' });

        expect(writes()).toEqual(['Failure']);
        expect(updateCart).not.toHaveBeenCalled();
      });

      it('fails with AmountMismatch when only the transaction amount differs', async () => {
        setup({ state: 'Pending', txCents: 9999 });
        client.getPayment.mockResolvedValue(ec('AUTHORIZED'));

        await expect(handleAuthorizeECPayment(PAYMENT_ID)).rejects.toMatchObject({ code: 'AmountMismatch' });

        expect(writes()).toEqual(['Failure']);
      });

      it('fails the transaction when the amount only diverges at AUTHORIZED time during polling', async () => {
        client.getPayment
          .mockResolvedValueOnce(ec('PREAUTHORIZED'))
          .mockResolvedValueOnce(ec('PREAUTHORIZED'))
          .mockResolvedValue(ec('AUTHORIZED', 90));

        const err = await settle(handleAuthorizeECPayment(PAYMENT_ID));

        expect(err).toMatchObject({ code: 'AmountMismatch', httpErrorStatus: 400 });
        expect(writes()).toEqual(['Pending', 'Failure']);
        expect(updateCart).toHaveBeenCalledWith(cart, [{ action: 'unfreezeCart' }]);
      });
    });

    describe('polling', () => {
      beforeEach(() => setup({ state: 'Pending' }));

      it('resumes polling without a new POST when Pending and PREAUTHORIZED', async () => {
        client.getPayment
          .mockResolvedValueOnce(ec('PREAUTHORIZED'))
          .mockResolvedValueOnce(ec('PREAUTHORIZED'))
          .mockResolvedValue(ec('AUTHORIZED'));

        const err = await settle(handleAuthorizeECPayment(PAYMENT_ID));

        expect(err).toBeUndefined();
        expect(client.authorizePayment).not.toHaveBeenCalled();
        expect(writes()).toEqual(['Success']);
      });

      it('succeeds when AUTHORIZED shows up on the 3rd getPayment call', async () => {
        client.getPayment
          .mockResolvedValueOnce(ec('PREAUTHORIZED'))
          .mockResolvedValueOnce(ec('PREAUTHORIZED'))
          .mockResolvedValueOnce(ec('AUTHORIZED'));

        const err = await settle(handleAuthorizeECPayment(PAYMENT_ID));

        expect(err).toBeUndefined();
        expect(client.getPayment).toHaveBeenCalledTimes(3);
        expect(writes()).toEqual(['Success']);
      });

      it.each(['DECLINED', 'EXPIRED'])('fails the transaction and throws when polling sees %s', async (status) => {
        client.getPayment
          .mockResolvedValueOnce(ec('PREAUTHORIZED'))
          .mockResolvedValueOnce(ec('PREAUTHORIZED'))
          .mockResolvedValue(ec(status));

        const err = await settle(handleAuthorizeECPayment(PAYMENT_ID));

        expect(err).toMatchObject({ code: 'TransactionNotAuthorized', httpErrorStatus: 400 });
        expect(writes()).toEqual(['Failure']);
        expect(updateCart).toHaveBeenCalledWith(cart, [{ action: 'unfreezeCart' }]);
      });

      it('survives transient getPayment errors and still succeeds', async () => {
        client.getPayment
          .mockResolvedValueOnce(ec('PREAUTHORIZED'))
          .mockRejectedValueOnce(new Error('network down'))
          .mockRejectedValueOnce(new Errorx({ code: 'Boom', message: 'upstream 503', httpErrorStatus: 503 }))
          .mockResolvedValue(ec('AUTHORIZED'));

        const err = await settle(handleAuthorizeECPayment(PAYMENT_ID));

        expect(err).toBeUndefined();
        expect(writes()).toEqual(['Success']);
      });

      it.each([
        ['a TypeError', new TypeError('fetch failed')],
        ['an AbortError', new DOMException('aborted', 'AbortError')],
        ['a TimeoutError', new DOMException('timed out', 'TimeoutError')],
        ['HTTP 500', new Errorx({ code: 'E', message: 'e', httpErrorStatus: 500 })],
        ['HTTP 502', new Errorx({ code: 'E', message: 'e', httpErrorStatus: 502 })],
        ['HTTP 408', new Errorx({ code: 'E', message: 'e', httpErrorStatus: 408 })],
        ['HTTP 429', new Errorx({ code: 'E', message: 'e', httpErrorStatus: 429 })],
      ])('retries a transient poll failure (%s)', async (_name, failure) => {
        client.getPayment
          .mockResolvedValueOnce(ec('PREAUTHORIZED'))
          .mockRejectedValueOnce(failure)
          .mockResolvedValue(ec('AUTHORIZED'));

        const err = await settle(handleAuthorizeECPayment(PAYMENT_ID));

        expect(err).toBeUndefined();
        expect(client.getPayment).toHaveBeenCalledTimes(3);
        expect(writes()).toEqual(['Success']);
      });

      it.each([400, 401, 403, 404, 409])(
        'rethrows a permanent HTTP %s from a poll immediately, without waiting for the timeout',
        async (httpErrorStatus) => {
          const permanent = new Errorx({ code: 'Permanent', message: 'nope', httpErrorStatus });
          client.getPayment.mockResolvedValueOnce(ec('PREAUTHORIZED')).mockRejectedValue(permanent);

          const err = await settle(handleAuthorizeECPayment(PAYMENT_ID), 5000);

          expect(err).toBe(permanent);
          expect(client.getPayment).toHaveBeenCalledTimes(2);
          expect(updatePayment).not.toHaveBeenCalled();
          expect(updateCart).not.toHaveBeenCalled();
          expect(ctState).toBe('Pending');
        },
      );

      it('passes an abort signal with a decreasing remaining time to each poll', async () => {
        const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
        try {
          client.getPayment
            .mockResolvedValueOnce(ec('PREAUTHORIZED'))
            .mockResolvedValueOnce(ec('PREAUTHORIZED'))
            .mockResolvedValueOnce(ec('PREAUTHORIZED'))
            .mockResolvedValueOnce(ec('AUTHORIZED'));

          const err = await settle(handleAuthorizeECPayment(PAYMENT_ID));

          expect(err).toBeUndefined();
          expect(client.getPayment.mock.calls[0]).toEqual([TECH_ID, expect.any(AbortSignal)]);
          expect(client.getPayment.mock.calls[1][1]).toBeInstanceOf(AbortSignal);
          expect(client.getPayment.mock.calls[2][1]).toBeInstanceOf(AbortSignal);
          expect(timeoutSpy.mock.calls).toEqual([[30000], [30000], [28000], [26000]]);
        } finally {
          timeoutSpy.mockRestore();
        }
      });

      it('throws AuthorizationTimeout (504) after 30s and writes no state after Pending', async () => {
        setup({ state: 'Initial' });
        client.getPayment.mockResolvedValue(ec('PREAUTHORIZED'));
        const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
        try {
          const start = Date.now();
          let settled = false;
          const result = handleAuthorizeECPayment(PAYMENT_ID).then(
            () => undefined,
            (e: unknown) => {
              settled = true;
              return e;
            },
          );

          await jest.advanceTimersByTimeAsync(29000);
          expect(settled).toBe(false);
          await jest.advanceTimersByTimeAsync(2000);
          const err = await result;

          expect(err).toMatchObject({ code: 'AuthorizationTimeout', httpErrorStatus: 504 });
          expect(Date.now() - start).toBeGreaterThanOrEqual(30000);
          expect(writes()).toEqual(['Pending']);
          expect(ctState).toBe('Pending');
          expect(updateCart).not.toHaveBeenCalled();
          const lastRemaining = timeoutSpy.mock.calls.at(-1)?.[0] as number;
          expect(lastRemaining).toBeGreaterThan(0);
          expect(lastRemaining).toBeLessThanOrEqual(2000);
        } finally {
          timeoutSpy.mockRestore();
        }
      });

      it('times out with 504 when every poll errors, leaving the transaction Pending', async () => {
        client.getPayment.mockResolvedValueOnce(ec('PREAUTHORIZED')).mockRejectedValue(new Error('network down'));

        const err = await settle(handleAuthorizeECPayment(PAYMENT_ID));

        expect(err).toMatchObject({ code: 'AuthorizationTimeout', httpErrorStatus: 504 });
        expect(updatePayment).not.toHaveBeenCalled();
        expect(ctState).toBe('Pending');
      });
    });

    describe('setTransactionState', () => {
      beforeEach(() => {
        setup({ state: 'Pending' });
        client.getPayment.mockResolvedValue(ec('AUTHORIZED'));
      });

      it('skips the write when the transaction is already in the target state', async () => {
        mock(getCartByPaymentId).mockImplementation(async () => {
          ctState = 'Success'; // a concurrent writer finishes between the handler read and the write
          return cart;
        });

        await expect(handleAuthorizeECPayment(PAYMENT_ID)).resolves.toBeUndefined();

        expect(updatePayment).not.toHaveBeenCalled();
      });

      it('re-reads and retries once on a 409 version conflict', async () => {
        mock(updatePayment).mockImplementationOnce(async () => {
          ctVersion = 5;
          throw new Errorx({ code: 'ConcurrentModification', message: 'conflict', httpErrorStatus: 409 });
        });

        await expect(handleAuthorizeECPayment(PAYMENT_ID)).resolves.toBeUndefined();

        expect(updatePayment).toHaveBeenCalledTimes(2);
        expect(mock(updatePayment).mock.calls[1][0].version).toBe(5);
        expect(mock(updatePayment).mock.calls[1][1]).toEqual([
          { action: 'changeTransactionState', transactionId: TX_ID, state: 'Success' },
        ]);
        expect(ctState).toBe('Success');
      });

      it('does not retry when the 409 re-read shows the target state already set', async () => {
        mock(updatePayment).mockImplementationOnce(async () => {
          ctState = 'Success';
          throw new Errorx({ code: 'ConcurrentModification', message: 'conflict', httpErrorStatus: 409 });
        });

        await expect(handleAuthorizeECPayment(PAYMENT_ID)).resolves.toBeUndefined();

        expect(updatePayment).toHaveBeenCalledTimes(1);
      });

      it('propagates a second 409', async () => {
        mock(updatePayment).mockImplementation(async () => {
          throw new Errorx({ code: 'ConcurrentModification', message: 'conflict', httpErrorStatus: 409 });
        });

        await expect(handleAuthorizeECPayment(PAYMENT_ID)).rejects.toMatchObject({ httpErrorStatus: 409 });

        expect(updatePayment).toHaveBeenCalledTimes(2);
      });

      it('propagates non-409 errors without retrying', async () => {
        mock(updatePayment).mockRejectedValue(
          new Errorx({ code: 'General', message: 'ct down', httpErrorStatus: 500 }),
        );

        await expect(handleAuthorizeECPayment(PAYMENT_ID)).rejects.toMatchObject({ httpErrorStatus: 500 });

        expect(updatePayment).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('handleAuthorizePayment (easyCredit callback)', () => {
    it('is a no-op when the transaction is already Success', async () => {
      setup({ state: 'Success' });

      await expect(handleAuthorizePayment(PAYMENT_ID)).resolves.toBeUndefined();

      expect(client.getPayment).not.toHaveBeenCalled();
      expect(updatePayment).not.toHaveBeenCalled();
    });

    it.each(['Initial', 'Pending'])('sets Success when easyCredit is AUTHORIZED (%s)', async (state) => {
      setup({ state });
      client.getPayment.mockResolvedValue(ec('AUTHORIZED'));

      await handleAuthorizePayment(PAYMENT_ID);

      expect(client.getPayment).toHaveBeenCalledWith(TECH_ID);
      expect(client.authorizePayment).not.toHaveBeenCalled();
      expect(writes()).toEqual(['Success']);
    });

    it('fails with AmountMismatch, fails the transaction and unfreezes the cart on a cart change', async () => {
      setup({ state: 'Pending', cart: buildCart('Frozen', 12000) });
      client.getPayment.mockResolvedValue(ec('AUTHORIZED'));

      await expect(handleAuthorizePayment(PAYMENT_ID)).rejects.toMatchObject({
        code: 'AmountMismatch',
        httpErrorStatus: 400,
      });

      expect(writes()).toEqual(['Failure']);
      expect(updateCart).toHaveBeenCalledWith(cart, [{ action: 'unfreezeCart' }]);
    });

    it.each(['DECLINED', 'EXPIRED'])('fails the transaction, unfreezes the cart and throws on %s', async (status) => {
      setup({ state: 'Pending' });
      client.getPayment.mockResolvedValue(ec(status));

      await expect(handleAuthorizePayment(PAYMENT_ID)).rejects.toMatchObject({
        code: 'TransactionNotAuthorized',
        httpErrorStatus: 400,
      });

      expect(writes()).toEqual(['Failure']);
      expect(updateCart).toHaveBeenCalledWith(cart, [{ action: 'unfreezeCart' }]);
    });

    it.each(['PREAUTHORIZED', 'OPEN'])('throws TransactionNotAuthorized without writes on %s', async (status) => {
      setup({ state: 'Pending' });
      client.getPayment.mockResolvedValue(ec(status));

      await expect(handleAuthorizePayment(PAYMENT_ID)).rejects.toMatchObject({
        code: 'TransactionNotAuthorized',
        httpErrorStatus: 400,
      });

      expect(updatePayment).not.toHaveBeenCalled();
      expect(updateCart).not.toHaveBeenCalled();
    });

    it('throws TransactionNotAuthorized without writes when the transaction is Failure', async () => {
      setup({ state: 'Failure' });
      client.getPayment.mockResolvedValue(ec('AUTHORIZED'));

      await expect(handleAuthorizePayment(PAYMENT_ID)).rejects.toMatchObject({
        code: 'TransactionNotAuthorized',
        httpErrorStatus: 400,
      });

      expect(updatePayment).not.toHaveBeenCalled();
      expect(updateCart).not.toHaveBeenCalled();
    });
  });
});

const divergenceLogs = () =>
  mock(log.error).mock.calls.filter(
    (c) => typeof c[0] === 'string' && c[0].startsWith('EASYCREDIT_AUTHORIZED_CT_NOT_SUCCESS'),
  );

const expectDivergenceLogged = () => {
  expect(divergenceLogs()).toHaveLength(1);
  expect(divergenceLogs()[0][1]).toEqual(
    expect.objectContaining({
      paymentId: PAYMENT_ID,
      technicalTransactionId: TECH_ID,
      reason: expect.any(String),
    }),
  );
};

describe('easyCredit AUTHORIZED but commercetools not Success (divergence log)', () => {
  beforeEach(() => {
    mock(log.error).mockClear();
  });

  it.each([
    ['cart no longer Frozen', buildCart('Active'), 10000, 100],
    ['cart total changed', buildCart('Frozen', 12000), 10000, 100],
    ['transaction amount differs', buildCart(), 9999, 100],
    ['easyCredit amount differs', buildCart(), 10000, 90],
  ])('logs the divergence when the authorize flow fails with AmountMismatch (%s)', async (_n, c, tCents, ecValue) => {
    setup({ state: 'Pending', cart: c, txCents: tCents });
    client.getPayment.mockResolvedValue(ec('AUTHORIZED', ecValue));

    await expect(handleAuthorizeECPayment(PAYMENT_ID)).rejects.toMatchObject({ code: 'AmountMismatch' });

    expectDivergenceLogged();
    // the log carries the private detail, not the public message
    expect((divergenceLogs()[0][1] as { reason: string }).reason).toMatch(/^AmountMismatch: cart /);
  });

  it('logs the divergence when the amount diverges at AUTHORIZED time during polling', async () => {
    client.getPayment
      .mockResolvedValueOnce(ec('PREAUTHORIZED'))
      .mockResolvedValueOnce(ec('PREAUTHORIZED'))
      .mockResolvedValue(ec('AUTHORIZED', 90));

    const err = await settle(handleAuthorizeECPayment(PAYMENT_ID));

    expect(err).toMatchObject({ code: 'AmountMismatch' });
    expectDivergenceLogged();
  });

  it('logs the divergence when the callback fails with AmountMismatch', async () => {
    setup({ state: 'Pending', cart: buildCart('Active') });
    client.getPayment.mockResolvedValue(ec('AUTHORIZED'));

    await expect(handleAuthorizePayment(PAYMENT_ID)).rejects.toMatchObject({ code: 'AmountMismatch' });

    expectDivergenceLogged();
  });

  it('does not log it for the pre-POST amount check (easyCredit is only PREAUTHORIZED)', async () => {
    setup({ cart: buildCart('Active') });
    client.getPayment.mockResolvedValue(ec('PREAUTHORIZED'));

    await expect(handleAuthorizeECPayment(PAYMENT_ID)).rejects.toMatchObject({ code: 'AmountMismatch' });

    expect(divergenceLogs()).toHaveLength(0);
  });

  it('does not log it on a successful authorization', async () => {
    setup({ state: 'Pending' });
    client.getPayment.mockResolvedValue(ec('AUTHORIZED'));

    await handleAuthorizeECPayment(PAYMENT_ID);

    expect(divergenceLogs()).toHaveLength(0);
  });

  it('does not log it when easyCredit DECLINED the payment', async () => {
    setup({ state: 'Pending' });
    client.getPayment.mockResolvedValue(ec('DECLINED'));

    await expect(handleAuthorizeECPayment(PAYMENT_ID)).rejects.toMatchObject({ code: 'TransactionNotAuthorized' });

    expect(divergenceLogs()).toHaveLength(0);
  });

  it('logs it in the callback when the transaction is Failure and easyCredit is AUTHORIZED, still throwing 400', async () => {
    setup({ state: 'Failure' });
    client.getPayment.mockResolvedValue(ec('AUTHORIZED'));

    await expect(handleAuthorizePayment(PAYMENT_ID)).rejects.toMatchObject({
      code: 'TransactionNotAuthorized',
      httpErrorStatus: 400,
    });

    expectDivergenceLogged();
    expect(updatePayment).not.toHaveBeenCalled();
    expect(updateCart).not.toHaveBeenCalled();
  });

  it.each(['PREAUTHORIZED', 'DECLINED'])(
    'does not log it in the callback when the transaction is Failure and easyCredit is %s',
    async (status) => {
      setup({ state: 'Failure' });
      client.getPayment.mockResolvedValue(ec(status));

      await expect(handleAuthorizePayment(PAYMENT_ID)).rejects.toMatchObject({ code: 'TransactionNotAuthorized' });

      expect(divergenceLogs()).toHaveLength(0);
      expect(updatePayment).not.toHaveBeenCalled();
    },
  );

  it('still throws TransactionNotAuthorized when the easyCredit lookup fails on a Failure transaction', async () => {
    setup({ state: 'Failure' });
    client.getPayment.mockRejectedValue(new Error('network down'));

    await expect(handleAuthorizePayment(PAYMENT_ID)).rejects.toMatchObject({
      code: 'TransactionNotAuthorized',
      httpErrorStatus: 400,
    });

    expect(updatePayment).not.toHaveBeenCalled();
  });
});

describe('handleGetPayment with a legacy payment', () => {
  it("treats paymentMethodInfo.method 'easycredit' as INSTALLMENT_PAYMENT", async () => {
    setup({ method: 'easycredit' });
    client.getPayment.mockResolvedValue(ec('AUTHORIZED'));

    const result = await handleGetPayment(PAYMENT_ID);

    expect(client.getPayment).toHaveBeenCalledWith(TECH_ID);
    expect(result.paymentType).toBe('INSTALLMENT_PAYMENT');
    expect(result.amount).toBe(100);
  });

  it('keeps BILL_PAYMENT for a bill payment', async () => {
    setup({ method: 'BILL_PAYMENT' });
    client.getPayment.mockResolvedValue(ec('AUTHORIZED'));

    const result = await handleGetPayment(PAYMENT_ID);

    expect(result.paymentType).toBe('BILL_PAYMENT');
  });
});

describe('R2: first easyCredit lookup in handleAuthorizeECPayment', () => {
  const abortLike = (name: string) => new DOMException('The operation was aborted', name);

  it.each([
    ['Initial', 'TimeoutError'],
    ['Initial', 'AbortError'],
    ['Pending', 'TimeoutError'],
    ['Pending', 'AbortError'],
  ])('maps a %s first-lookup %s to AuthorizationTimeout 504 without writes or POST', async (state, name) => {
    setup({ state });
    client.getPayment.mockRejectedValue(abortLike(name));

    const err = await settle(handleAuthorizeECPayment(PAYMENT_ID));

    expect(err).toBeInstanceOf(Errorx);
    expect(err).toMatchObject({ code: 'AuthorizationTimeout', httpErrorStatus: 504 });
    expect(client.authorizePayment).not.toHaveBeenCalled();
    expect(updatePayment).not.toHaveBeenCalled();
    expect(updateCart).not.toHaveBeenCalled();
    expect(ctState).toBe(state);
  });

  it('lets a non-abort error from the first lookup propagate unchanged', async () => {
    const boom = new Error('boom');
    client.getPayment.mockRejectedValue(boom);

    const err = await settle(handleAuthorizeECPayment(PAYMENT_ID));

    expect(err).toBe(boom);
    expect(client.authorizePayment).not.toHaveBeenCalled();
    expect(updatePayment).not.toHaveBeenCalled();
  });
});

describe('R2: callback divergence lookup on a Failure transaction', () => {
  it('passes a 5000 ms abort signal to the best-effort easyCredit lookup', async () => {
    setup({ state: 'Failure' });
    client.getPayment.mockResolvedValue(ec('AUTHORIZED'));
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');

    await expect(handleAuthorizePayment(PAYMENT_ID)).rejects.toMatchObject({ code: 'TransactionNotAuthorized' });

    expect(timeoutSpy).toHaveBeenCalledWith(5000);
    expect(client.getPayment).toHaveBeenCalledWith(TECH_ID, expect.any(AbortSignal));
    timeoutSpy.mockRestore();
  });

  it('still throws TransactionNotAuthorized 400 when the lookup is aborted', async () => {
    setup({ state: 'Failure' });
    client.getPayment.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));

    await expect(handleAuthorizePayment(PAYMENT_ID)).rejects.toMatchObject({
      code: 'TransactionNotAuthorized',
      httpErrorStatus: 400,
    });
    expect(updatePayment).not.toHaveBeenCalled();
  });
});

describe('R2: divergence log when the amount check itself errors while easyCredit is AUTHORIZED', () => {
  beforeEach(() => {
    mock(log.error).mockClear();
  });

  const expectLoggedOnceWithReason = (reason: string) => {
    expect(divergenceLogs()).toHaveLength(1);
    expect(divergenceLogs()[0][1]).toEqual(
      expect.objectContaining({ paymentId: PAYMENT_ID, technicalTransactionId: TECH_ID }),
    );
    expect((divergenceLogs()[0][1] as { reason: string }).reason).toContain(reason);
  };

  it('logs once and rethrows the original error when the cart lookup rejects (authorize flow)', async () => {
    setup({ state: 'Pending' });
    client.getPayment.mockResolvedValue(ec('AUTHORIZED'));
    const boom = new Error('cart lookup failed');
    mock(getCartByPaymentId).mockRejectedValue(boom);

    await expect(handleAuthorizeECPayment(PAYMENT_ID)).rejects.toBe(boom);

    expectLoggedOnceWithReason('cart lookup failed');
  });

  it('logs once and rethrows the original error when the cart lookup rejects (callback)', async () => {
    setup({ state: 'Pending' });
    client.getPayment.mockResolvedValue(ec('AUTHORIZED'));
    const boom = new Error('cart lookup failed');
    mock(getCartByPaymentId).mockRejectedValue(boom);

    await expect(handleAuthorizePayment(PAYMENT_ID)).rejects.toBe(boom);

    expectLoggedOnceWithReason('cart lookup failed');
  });

  it('logs once when the payment re-read rejects during the amount check', async () => {
    setup({ state: 'Pending' });
    client.getPayment.mockResolvedValue(ec('AUTHORIZED'));
    const boom = new Error('payment read failed');
    mock(getPaymentById)
      .mockResolvedValueOnce(buildPayment() as never)
      .mockRejectedValueOnce(boom);

    await expect(handleAuthorizeECPayment(PAYMENT_ID)).rejects.toBe(boom);

    expectLoggedOnceWithReason('payment read failed');
  });

  it('does not log it when the pre-POST amount check errors (easyCredit only PREAUTHORIZED)', async () => {
    client.getPayment.mockResolvedValue(ec('PREAUTHORIZED'));
    mock(getCartByPaymentId).mockRejectedValue(new Error('cart lookup failed'));

    await expect(handleAuthorizeECPayment(PAYMENT_ID)).rejects.toThrow('cart lookup failed');

    expect(divergenceLogs()).toHaveLength(0);
  });

  it('logs exactly once for an AmountMismatch (no double log)', async () => {
    setup({ state: 'Pending', cart: buildCart('Active') });
    client.getPayment.mockResolvedValue(ec('AUTHORIZED'));

    await expect(handleAuthorizePayment(PAYMENT_ID)).rejects.toMatchObject({ code: 'AmountMismatch' });

    expect(divergenceLogs()).toHaveLength(1);
  });
});
