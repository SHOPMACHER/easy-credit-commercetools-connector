import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Errorx } from '@commercetools/connect-payments-sdk';
import { handleCancelPayment } from '../../src/services/payment.service';
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

const buildPayment = (state: string, method = 'INSTALLMENT_PAYMENT') => ({
  id: PAYMENT_ID,
  version: 3,
  paymentMethodInfo: { paymentInterface: 'easycredit', method },
  transactions: [
    {
      id: TX_ID,
      type: 'Authorization',
      state,
      interactionId: 'ec-1',
      amount: { centAmount: 10000, currencyCode: 'EUR', fractionDigits: 2 },
      custom: { fields: { easyCreditTechnicalTransactionId: TECH_ID } },
    },
  ],
});

const cart = { id: 'cart-1', version: 1, cartState: 'Frozen' };

const client = { getPayment: jest.fn<AnyFn>() };

const divergenceLogs = () =>
  mock(log.error).mock.calls.filter(
    (c) => typeof c[0] === 'string' && c[0].startsWith('EASYCREDIT_AUTHORIZED_CT_NOT_SUCCESS'),
  );

const stateWrites = () =>
  mock(updatePayment).mock.calls.flatMap((c) =>
    (c[1] as { action: string; state?: string }[])
      .filter((a) => a.action === 'changeTransactionState')
      .map((a) => a.state),
  );

describe.each(['INSTALLMENT_PAYMENT', 'BILL_PAYMENT'])('handleCancelPayment divergence check (%s)', (method) => {
  beforeEach(() => {
    jest.clearAllMocks();
    client.getPayment.mockReset();
    mock(initEasyCreditClient).mockReturnValue(client);
    mock(getCartByPaymentId).mockResolvedValue(cart);
    mock(updateCart).mockResolvedValue(cart);
    mock(updatePayment).mockResolvedValue({});
  });

  it('cancels an Initial transaction with a single easyCredit lookup and no divergence check', async () => {
    mock(getPaymentById).mockResolvedValue(buildPayment('Initial', method));
    client.getPayment.mockResolvedValue({ status: 'PREAUTHORIZED' });

    await expect(handleCancelPayment(PAYMENT_ID)).resolves.toBe(PAYMENT_ID);

    expect(client.getPayment).toHaveBeenCalledTimes(1);
    expect(stateWrites()).toEqual(['Failure']);
    expect(updateCart).toHaveBeenCalledWith(cart, [{ action: 'unfreezeCart' }]);
    expect(divergenceLogs()).toHaveLength(0);
  });

  it('cancels a Pending transaction and re-checks easyCredit after the Failure write with a bounded lookup', async () => {
    mock(getPaymentById).mockResolvedValue(buildPayment('Pending', method));
    client.getPayment.mockResolvedValue({ status: 'PREAUTHORIZED' });
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');

    await expect(handleCancelPayment(PAYMENT_ID)).resolves.toBe(PAYMENT_ID);

    expect(client.getPayment).toHaveBeenCalledTimes(2);
    expect(client.getPayment).toHaveBeenLastCalledWith(TECH_ID, expect.any(AbortSignal));
    expect(timeoutSpy).toHaveBeenCalledWith(5000);
    expect(mock(updatePayment).mock.invocationCallOrder[0]).toBeLessThan(client.getPayment.mock.invocationCallOrder[1]);
    expect(stateWrites()).toEqual(['Failure']);
    expect(divergenceLogs()).toHaveLength(0);
    timeoutSpy.mockRestore();
  });

  it('logs the divergence once when easyCredit turns AUTHORIZED during a cancel of a Pending transaction', async () => {
    mock(getPaymentById).mockResolvedValue(buildPayment('Pending', method));
    client.getPayment
      .mockResolvedValueOnce({ status: 'PREAUTHORIZED' })
      .mockResolvedValueOnce({ status: 'AUTHORIZED' });

    await expect(handleCancelPayment(PAYMENT_ID)).resolves.toBe(PAYMENT_ID);

    expect(divergenceLogs()).toHaveLength(1);
    expect(divergenceLogs()[0][1]).toEqual(
      expect.objectContaining({
        paymentId: PAYMENT_ID,
        technicalTransactionId: TECH_ID,
        reason: expect.stringContaining('cancel'),
      }),
    );
    expect(updateCart).toHaveBeenCalledWith(cart, [{ action: 'unfreezeCart' }]);
  });

  it('still cancels and does not log a divergence when the re-check lookup fails', async () => {
    mock(getPaymentById).mockResolvedValue(buildPayment('Pending', method));
    client.getPayment
      .mockResolvedValueOnce({ status: 'PREAUTHORIZED' })
      .mockRejectedValueOnce(new Error('easyCredit unavailable'));

    await expect(handleCancelPayment(PAYMENT_ID)).resolves.toBe(PAYMENT_ID);

    expect(stateWrites()).toEqual(['Failure']);
    expect(divergenceLogs()).toHaveLength(0);
    expect(updateCart).toHaveBeenCalledWith(cart, [{ action: 'unfreezeCart' }]);
  });

  // Live: easyCredit invalidates an older transaction once a newer one exists (its page shows error 410), and the
  // status of the lookup for such a transaction is 404 or 410. The cart must not stay frozen because of that.
  it.each([404, 410])(
    'cancels and unfreezes the cart when the easyCredit lookup answers %s (transaction gone)',
    async (httpErrorStatus) => {
      mock(getPaymentById).mockResolvedValue(buildPayment('Initial', method));
      client.getPayment.mockRejectedValue(new Errorx({ code: 'Gone', message: 'gone', httpErrorStatus }));

      await expect(handleCancelPayment(PAYMENT_ID)).resolves.toBe(PAYMENT_ID);

      expect(stateWrites()).toEqual(['Failure']);
      expect(updateCart).toHaveBeenCalledWith(cart, [{ action: 'unfreezeCart' }]);
      expect(divergenceLogs()).toHaveLength(0);
    },
  );

  it('cancels a Pending transaction whose easyCredit transaction is gone', async () => {
    mock(getPaymentById).mockResolvedValue(buildPayment('Pending', method));
    client.getPayment.mockRejectedValue(new Errorx({ code: 'Gone', message: 'gone', httpErrorStatus: 410 }));

    await expect(handleCancelPayment(PAYMENT_ID)).resolves.toBe(PAYMENT_ID);

    expect(stateWrites()).toEqual(['Failure']);
    expect(updateCart).toHaveBeenCalledWith(cart, [{ action: 'unfreezeCart' }]);
    expect(divergenceLogs()).toHaveLength(0);
  });

  it.each([
    ['an HTTP 500', new Errorx({ code: 'Boom', message: 'x', httpErrorStatus: 500 })],
    ['a network error', new Error('socket hang up')],
  ])('rethrows and changes nothing when the easyCredit lookup fails with %s', async (_name, failure) => {
    mock(getPaymentById).mockResolvedValue(buildPayment('Initial', method));
    client.getPayment.mockRejectedValue(failure);

    await expect(handleCancelPayment(PAYMENT_ID)).rejects.toBe(failure);

    expect(updatePayment).not.toHaveBeenCalled();
    expect(updateCart).not.toHaveBeenCalled();
  });

  it('keeps refusing to cancel when easyCredit is already AUTHORIZED, without writes or divergence log', async () => {
    mock(getPaymentById).mockResolvedValue(buildPayment('Pending', method));
    client.getPayment.mockResolvedValue({ status: 'AUTHORIZED' });

    await expect(handleCancelPayment(PAYMENT_ID)).rejects.toMatchObject({
      code: 'TransactionIsAuthorized',
      httpErrorStatus: 400,
    });

    expect(client.getPayment).toHaveBeenCalledTimes(1);
    expect(updatePayment).not.toHaveBeenCalled();
    expect(updateCart).not.toHaveBeenCalled();
    expect(divergenceLogs()).toHaveLength(0);
  });
});
