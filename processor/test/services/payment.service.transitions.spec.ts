import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Errorx } from '@commercetools/connect-payments-sdk';
import { handleAuthorizeECPayment, handleAuthorizePayment } from '../../src/services/payment.service';
import { getCartByPaymentId, updateCart } from '../../src/commercetools/cart.commercetools';
import { getPaymentById, updatePayment } from '../../src/commercetools/payment.commercetools';
import { initEasyCreditClient } from '../../src/client/easycredit.client';
import { log } from '../../src/libs/logger';
import { getShippingAddress, getShippingDestinations } from '../../src/utils/map.utils';

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
  billingAddress: Record<string, unknown>;
  shippingAddress: Record<string, unknown>;
  totalPrice: { centAmount: number; currencyCode: string; fractionDigits: number };
};

// Stateful commercetools fake: the payment is rebuilt from these on every read.
let ctState: string;
let ctVersion: number;
let ctMethod: string;
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
      amount: { centAmount: 10000, currencyCode: 'EUR', fractionDigits: 2 },
      custom: { fields: { easyCreditTechnicalTransactionId: TECH_ID } },
    },
  ],
});

const address = {
  firstName: 'Erika',
  lastName: 'Mustermann',
  streetName: 'Hauptstrasse',
  streetNumber: '1',
  city: 'Gescher',
  postalCode: '48712',
  country: 'DE',
};

const buildCart = (cartState = 'Frozen', centAmount = 10000): TestCart => ({
  id: 'cart-1',
  cartState,
  billingAddress: { ...address },
  shippingAddress: { ...address },
  totalPrice: { centAmount, currencyCode: 'EUR', fractionDigits: 2 },
});

const ec = (status: string, orderValue = 100) => ({
  status,
  decision: { transactionId: 'ec-tx-1', orderValue, decisionOutcome: 'POSITIVE' },
  transaction: { financingTerm: 12, paymentType: ctMethod, orderDetails: { orderValue, orderId: PAYMENT_ID } },
});

const writes = () => mock(updatePayment).mock.calls.map((c) => c[1][0].state);

const divergenceLogs = () =>
  mock(log.error).mock.calls.filter(
    (c) => typeof c[0] === 'string' && c[0].startsWith('EASYCREDIT_AUTHORIZED_CT_NOT_SUCCESS'),
  );

const settle = async (promise: Promise<unknown>, ms = 60000) => {
  const result = promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  await jest.advanceTimersByTimeAsync(ms);
  return result;
};

// What a concurrent writer does through the same commercetools fake.
const concurrentWrite = (state: string) => {
  ctState = state;
  ctVersion += 1;
};

const conflict = () => new Errorx({ code: 'ConcurrentModification', message: 'conflict', httpErrorStatus: 409 });

beforeEach(() => {
  jest.useFakeTimers();
  ctState = 'Initial';
  ctVersion = 1;
  cart = buildCart();
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
  mock(getShippingAddress)
    .mockReset()
    .mockImplementation((c: any) => c.shippingAddress);
  mock(getShippingDestinations)
    .mockReset()
    .mockImplementation((c: any) => [c.shippingAddress]);
  mock(log.error).mockClear();
  mock(log.warn).mockClear();
  client.getPayment.mockReset();
  client.authorizePayment.mockReset().mockResolvedValue(true);
  mock(initEasyCreditClient).mockReset().mockReturnValue(client);
});

afterEach(() => {
  jest.useRealTimers();
});

describe.each(['INSTALLMENT_PAYMENT', 'BILL_PAYMENT'])('R3 transitions, payment type %s', (method) => {
  beforeEach(() => {
    ctMethod = method;
  });

  describe('Success is never overwritten by Pending', () => {
    it('writes nothing after the POST when a fast callback already wrote Success', async () => {
      client.getPayment.mockResolvedValueOnce(ec('PREAUTHORIZED')).mockResolvedValue(ec('AUTHORIZED'));
      client.authorizePayment.mockImplementation(async () => {
        // The easyCredit callback lands while the POST is still in flight.
        await updatePayment(buildPayment() as never, [
          { action: 'changeTransactionState', transactionId: TX_ID, state: 'Success' },
        ]);
        return true;
      });

      const err = await settle(handleAuthorizeECPayment(PAYMENT_ID));

      expect(err).toBeUndefined();
      expect(writes()).toEqual(['Success']);
      expect(ctState).toBe('Success');
      expect(updateCart).not.toHaveBeenCalled();
      expect(
        mock(log.error).mock.calls.filter((c) => String(c[0]).startsWith('EASYCREDIT_AUTHORIZATION_SENT')),
      ).toEqual([]);
    });

    it('does not overwrite Failure with Pending either', async () => {
      client.getPayment.mockResolvedValueOnce(ec('PREAUTHORIZED')).mockResolvedValue(ec('DECLINED'));
      client.authorizePayment.mockImplementation(async () => {
        concurrentWrite('Failure');
        return true;
      });

      const err = await settle(handleAuthorizeECPayment(PAYMENT_ID));

      expect(err).toMatchObject({ code: 'TransactionNotAuthorized' });
      expect(writes()).toEqual([]);
      expect(ctState).toBe('Failure');
    });
  });

  describe('Success is never overwritten by Failure', () => {
    it('returns normally for an Ordered cart when an overlapping flow already wrote Success (callback)', async () => {
      ctState = 'Pending';
      client.getPayment.mockImplementation(async () => {
        // The poll of the authorize flow finished first and the storefront placed the order.
        concurrentWrite('Success');
        cart = buildCart('Ordered');
        return ec('AUTHORIZED');
      });

      await expect(handleAuthorizePayment(PAYMENT_ID)).resolves.toBeUndefined();

      expect(updatePayment).not.toHaveBeenCalled();
      expect(updateCart).not.toHaveBeenCalled();
      expect(divergenceLogs()).toHaveLength(0);
      expect(ctState).toBe('Success');
    });

    it('returns normally for an Ordered cart when an overlapping flow already wrote Success (authorize)', async () => {
      ctState = 'Pending';
      client.getPayment.mockImplementation(async () => {
        concurrentWrite('Success');
        cart = buildCart('Ordered');
        return ec('AUTHORIZED');
      });

      await expect(handleAuthorizeECPayment(PAYMENT_ID)).resolves.toBeUndefined();

      expect(updatePayment).not.toHaveBeenCalled();
      expect(updateCart).not.toHaveBeenCalled();
      expect(divergenceLogs()).toHaveLength(0);
    });

    it('does not write Failure or unfreeze when DECLINED arrives after a concurrent Success', async () => {
      ctState = 'Pending';
      client.getPayment.mockImplementation(async () => {
        concurrentWrite('Success');
        return ec('DECLINED');
      });

      await expect(handleAuthorizePayment(PAYMENT_ID)).rejects.toMatchObject({ code: 'TransactionNotAuthorized' });

      expect(updatePayment).not.toHaveBeenCalled();
      expect(updateCart).not.toHaveBeenCalled();
      expect(ctState).toBe('Success');
    });

    it('still unfreezes the cart without a write when the transaction is already Failure', async () => {
      ctState = 'Pending';
      client.getPayment.mockImplementation(async () => {
        concurrentWrite('Failure');
        return ec('DECLINED');
      });

      await expect(handleAuthorizePayment(PAYMENT_ID)).rejects.toMatchObject({ code: 'TransactionNotAuthorized' });

      expect(updatePayment).not.toHaveBeenCalled();
      expect(updateCart).toHaveBeenCalledWith(cart, [{ action: 'unfreezeCart' }]);
    });
  });

  describe('Failure is never overwritten by Success', () => {
    it.each([
      ['callback', () => handleAuthorizePayment(PAYMENT_ID)],
      ['authorize', () => handleAuthorizeECPayment(PAYMENT_ID)],
    ])('throws TransactionNotAuthorized and logs the divergence once (%s)', async (_name, run) => {
      ctState = 'Pending';
      client.getPayment.mockResolvedValue(ec('AUTHORIZED'));
      mock(getCartByPaymentId).mockImplementation(async () => {
        concurrentWrite('Failure'); // e.g. a cancel lands during the amount check
        return cart;
      });

      await expect(run()).rejects.toMatchObject({ code: 'TransactionNotAuthorized', httpErrorStatus: 400 });

      expect(updatePayment).not.toHaveBeenCalled();
      expect(ctState).toBe('Failure');
      expect(divergenceLogs()).toHaveLength(1);
      expect(divergenceLogs()[0][1]).toEqual(expect.objectContaining({ paymentId: PAYMENT_ID }));
    });

    it('re-evaluates the transition on the fresh state after a 409', async () => {
      ctState = 'Pending';
      client.getPayment.mockResolvedValue(ec('AUTHORIZED'));
      mock(updatePayment).mockImplementationOnce(async () => {
        concurrentWrite('Failure');
        throw conflict();
      });

      await expect(handleAuthorizeECPayment(PAYMENT_ID)).rejects.toMatchObject({ code: 'TransactionNotAuthorized' });

      expect(updatePayment).toHaveBeenCalledTimes(1);
      expect(ctState).toBe('Failure');
    });

    it('warns with payment id, current and requested state when a transition is refused', async () => {
      ctState = 'Pending';
      client.getPayment.mockResolvedValue(ec('AUTHORIZED'));
      mock(getCartByPaymentId).mockImplementation(async () => {
        concurrentWrite('Failure');
        return cart;
      });

      await expect(handleAuthorizePayment(PAYMENT_ID)).rejects.toMatchObject({ code: 'TransactionNotAuthorized' });

      expect(log.warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ paymentId: PAYMENT_ID, currentState: 'Failure', requestedState: 'Success' }),
      );
    });
  });

  describe('allowed transitions and the 409 retry', () => {
    it.each([
      ['Initial', 'AUTHORIZED', ['Success']],
      ['Initial', 'DECLINED', ['Failure']],
      ['Pending', 'AUTHORIZED', ['Success']],
      ['Pending', 'DECLINED', ['Failure']],
    ])('writes %s -> %s', async (state, status, expected) => {
      ctState = state;
      client.getPayment.mockResolvedValue(ec(status));

      await handleAuthorizePayment(PAYMENT_ID).catch(() => undefined);

      expect(writes()).toEqual(expected);
    });

    it('writes Initial -> Pending after the POST', async () => {
      client.getPayment.mockResolvedValueOnce(ec('PREAUTHORIZED')).mockResolvedValue(ec('AUTHORIZED'));

      const err = await settle(handleAuthorizeECPayment(PAYMENT_ID));

      expect(err).toBeUndefined();
      expect(writes()).toEqual(['Pending', 'Success']);
    });

    it('skips the write when the 409 re-read shows the target state (Success)', async () => {
      ctState = 'Pending';
      client.getPayment.mockResolvedValue(ec('AUTHORIZED'));
      mock(updatePayment).mockImplementationOnce(async () => {
        concurrentWrite('Success');
        throw conflict();
      });

      await expect(handleAuthorizeECPayment(PAYMENT_ID)).resolves.toBeUndefined();

      expect(updatePayment).toHaveBeenCalledTimes(1);
      expect(log.warn).not.toHaveBeenCalled();
    });
  });

  describe('finalizeSuccess is idempotent', () => {
    it.each([
      ['callback', () => handleAuthorizePayment(PAYMENT_ID)],
      ['authorize', () => handleAuthorizeECPayment(PAYMENT_ID)],
    ])('returns without a cart check when the transaction is already Success (%s)', async (_name, run) => {
      ctState = 'Pending';
      client.getPayment.mockImplementation(async () => {
        concurrentWrite('Success');
        return ec('AUTHORIZED');
      });

      await expect(run()).resolves.toBeUndefined();

      expect(getCartByPaymentId).not.toHaveBeenCalled();
      expect(updatePayment).not.toHaveBeenCalled();
      expect(divergenceLogs()).toHaveLength(0);
    });
  });
});
