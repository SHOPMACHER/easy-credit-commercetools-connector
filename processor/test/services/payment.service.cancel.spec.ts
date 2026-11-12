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
  getPaymentTypeConfig:
    jest.requireActual<typeof import('../../src/utils/config.utils')>('../../src/utils/config.utils')
      .getPaymentTypeConfig,
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

describe.each(['INSTALLMENT_PAYMENT', 'BILL_PAYMENT'])('handleCancelPayment (%s)', (method) => {
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

  const expectRefusedWithoutChanges = async () => {
    await expect(handleCancelPayment(PAYMENT_ID)).rejects.toMatchObject({
      code: 'PaymentInProgress',
      httpErrorStatus: 400,
    });
    expect(updatePayment).not.toHaveBeenCalled();
    expect(updateCart).not.toHaveBeenCalled();
  };

  // Pending: the authorization request is already at easyCredit, which can still authorize it.
  it.each(['PREAUTHORIZED', 'OPEN'])(
    'refuses to cancel a Pending transaction while easyCredit reports %s',
    async (status) => {
      mock(getPaymentById).mockResolvedValue(buildPayment('Pending', method));
      client.getPayment.mockResolvedValue({ status });

      await expectRefusedWithoutChanges();
    },
  );

  // DECLINED and EXPIRED are final: easyCredit can no longer authorize the payment.
  it.each(['DECLINED', 'EXPIRED'])('cancels a Pending transaction that easyCredit reports as %s', async (status) => {
    mock(getPaymentById).mockResolvedValue(buildPayment('Pending', method));
    client.getPayment.mockResolvedValue({ status });

    await expect(handleCancelPayment(PAYMENT_ID)).resolves.toBe(PAYMENT_ID);

    expect(stateWrites()).toEqual(['Failure']);
    expect(updateCart).toHaveBeenCalledWith(cart, [{ action: 'unfreezeCart' }]);
  });

  it('refuses to cancel a declined Pending transaction that turns Success before the Failure write', async () => {
    mock(getPaymentById)
      .mockResolvedValueOnce(buildPayment('Pending', method))
      .mockResolvedValue(buildPayment('Success', method));
    client.getPayment.mockResolvedValue({ status: 'DECLINED' });

    await expect(handleCancelPayment(PAYMENT_ID)).rejects.toMatchObject({ code: 'TransactionIsAuthorized' });
    expect(updatePayment).not.toHaveBeenCalled();
    expect(updateCart).not.toHaveBeenCalled();
  });

  it('unfreezes the cart when a decline callback writes Failure before the cancel re-reads', async () => {
    mock(getPaymentById)
      .mockResolvedValueOnce(buildPayment('Initial', method))
      .mockResolvedValueOnce(buildPayment('Pending', method))
      .mockResolvedValue(buildPayment('Failure', method));
    client.getPayment.mockResolvedValue({ status: 'PREAUTHORIZED' });

    await expect(handleCancelPayment(PAYMENT_ID)).resolves.toBe(PAYMENT_ID);

    expect(updatePayment).not.toHaveBeenCalled();
    expect(updateCart).toHaveBeenCalledWith(cart, [{ action: 'unfreezeCart' }]);
  });

  it('refuses to cancel an Initial transaction that turns Pending before the Failure write', async () => {
    mock(getPaymentById)
      .mockResolvedValueOnce(buildPayment('Initial', method))
      .mockResolvedValue(buildPayment('Pending', method));
    client.getPayment.mockResolvedValue({ status: 'PREAUTHORIZED' });

    await expectRefusedWithoutChanges();
  });

  it('refuses to cancel when a parallel Pending write makes the Failure write conflict', async () => {
    mock(getPaymentById)
      .mockResolvedValueOnce(buildPayment('Initial', method))
      .mockResolvedValueOnce(buildPayment('Initial', method))
      .mockResolvedValue(buildPayment('Pending', method));
    client.getPayment.mockResolvedValue({ status: 'PREAUTHORIZED' });
    mock(updatePayment).mockRejectedValueOnce(
      new Errorx({ code: 'ConcurrentModification', message: 'x', httpErrorStatus: 409 }),
    );

    await expect(handleCancelPayment(PAYMENT_ID)).rejects.toMatchObject({ code: 'PaymentInProgress' });

    // Only the conflicting attempt: the retry reads Pending and does not write again.
    expect(updatePayment).toHaveBeenCalledTimes(1);
    expect(updateCart).not.toHaveBeenCalled();
  });

  it('answers TransactionIsAuthorized when the transaction turns Success before the Failure write', async () => {
    mock(getPaymentById)
      .mockResolvedValueOnce(buildPayment('Initial', method))
      .mockResolvedValue(buildPayment('Success', method));
    client.getPayment.mockResolvedValue({ status: 'PREAUTHORIZED' });

    await expect(handleCancelPayment(PAYMENT_ID)).rejects.toMatchObject({ code: 'TransactionIsAuthorized' });
    expect(updatePayment).not.toHaveBeenCalled();
    expect(updateCart).not.toHaveBeenCalled();
  });

  it('unfreezes the cart when a parallel cancel already wrote Failure', async () => {
    mock(getPaymentById)
      .mockResolvedValueOnce(buildPayment('Initial', method))
      .mockResolvedValue(buildPayment('Failure', method));
    client.getPayment.mockResolvedValue({ status: 'PREAUTHORIZED' });

    await expect(handleCancelPayment(PAYMENT_ID)).resolves.toBe(PAYMENT_ID);

    expect(updatePayment).not.toHaveBeenCalled();
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

  it('refuses to cancel a Pending transaction whose easyCredit transaction is gone', async () => {
    mock(getPaymentById).mockResolvedValue(buildPayment('Pending', method));
    client.getPayment.mockRejectedValue(new Errorx({ code: 'Gone', message: 'gone', httpErrorStatus: 410 }));

    await expectRefusedWithoutChanges();
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
