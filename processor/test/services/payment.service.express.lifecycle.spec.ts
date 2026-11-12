import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import fastify from 'fastify';
import { Cart, Errorx, MultiErrorx } from '@commercetools/connect-payments-sdk';
import {
  handleAuthorizeECPayment,
  handleCancelPayment,
  handleCreatePayment,
  handleExpressPaymentMethod,
  handleGetPayment,
  handlePaymentMethod,
} from '../../src/services/payment.service';
import { resetWebshopInfoCache } from '../../src/services/webshop.service';
import {
  findCartByPaymentId,
  getCartById,
  getCartByPaymentId,
  updateCart,
} from '../../src/commercetools/cart.commercetools';
import { getPaymentById, updatePayment } from '../../src/commercetools/payment.commercetools';
import { initEasyCreditClient } from '../../src/client/easycredit.client';
import { webhookRoute } from '../../src/routes/webhook.route';
import { errorHandler } from '../../src/libs/fastify/error-handler';
import { signRedirectUrl } from '../../src/utils/redirect.utils';
import { isPaymentCustomTypeReady } from '../../src/commercetools/customFields.commercetools';

// Runs the real service and validators; only the external APIs are mocked.
jest.mock('../../src/commercetools/cart.commercetools');

// The cart release looks the cart up without throwing; the tests set the cart through getCartByPaymentId.
beforeEach(() => {
  jest.mocked(findCartByPaymentId).mockImplementation((paymentId) => jest.mocked(getCartByPaymentId)(paymentId));
});
jest.mock('../../src/commercetools/payment.commercetools');
jest.mock('../../src/client/easycredit.client');
jest.mock('../../src/commercetools/customObject.commercetools');
jest.mock('../../src/commercetools/productType.commercetools');
jest.mock('../../src/commercetools/customFields.commercetools');

type AnyFn = (...args: any[]) => any;

const PAYMENT_ID = 'payment-1';
const PLACEHOLDER = { country: 'DE' };
const address = {
  country: 'DE',
  firstName: 'Max',
  lastName: 'Mustermann',
  streetName: 'Hauptstr.',
  streetNumber: '1',
  city: 'Berlin',
  postalCode: '10115',
};

const EXPRESS_WITH_PLACEHOLDER = { easyCreditExpress: true, easyCreditExpressPlaceholderAddress: true };

const buildPayment = (
  fields: Record<string, boolean> | null = EXPRESS_WITH_PLACEHOLDER,
  state = 'Initial',
  method = 'easycredit',
) => ({
  id: PAYMENT_ID,
  version: 1,
  paymentMethodInfo: { paymentInterface: 'easycredit', method },
  ...(fields && { custom: { type: { typeId: 'type', id: 'type-1' }, fields } }),
  transactions: [
    {
      id: 'tx-1',
      type: 'Authorization',
      state,
      interactionId: 'ec-1',
      amount: { centAmount: 50000, currencyCode: 'EUR', fractionDigits: 2 },
      custom: { fields: { easyCreditTechnicalTransactionId: 'tech-1' } },
    },
  ],
});

const buildCart = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'cart-1',
    version: 4,
    cartState: 'Frozen',
    lineItems: [],
    customLineItems: [],
    shipping: [],
    itemShippingAddresses: [],
    totalPrice: { currencyCode: 'EUR', centAmount: 50000, fractionDigits: 2 },
    shippingAddress: PLACEHOLDER,
    ...overrides,
  }) as unknown as Cart;

const preauthorized = (paymentType = 'INSTALLMENT_PAYMENT') => ({
  status: 'PREAUTHORIZED',
  decision: { orderValue: 500, decisionOutcome: 'POSITIVE' },
  transaction: { paymentType },
});

const failureWrite = [{ action: 'changeTransactionState', transactionId: 'tx-1', state: 'Failure' }];

const getErrorCodes = async (promise: Promise<unknown>) => {
  const error = await promise.catch((error: unknown) => error);

  if (error instanceof MultiErrorx) {
    return error.errors.map(({ code }) => code);
  }
  if (error instanceof Errorx) {
    return [error.code];
  }

  throw new Error(`Expected an Errorx or MultiErrorx, got ${String(error)}`);
};

describe('express payment lifecycle', () => {
  const client = {
    getPayment: jest.fn<AnyFn>(),
    authorizePayment: jest.fn<AnyFn>(),
    getWebshopInfo: jest.fn<AnyFn>(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    resetWebshopInfoCache();
    client.getPayment.mockReset();
    client.authorizePayment.mockReset().mockResolvedValue(undefined);
    client.getWebshopInfo.mockResolvedValue({
      availability: true,
      installmentPaymentActive: true,
      minInstallmentValue: 200,
      maxInstallmentValue: 10000,
      billPaymentActive: true,
      minBillingValue: 50,
      maxBillingValue: 5000,
    });
    jest.mocked(initEasyCreditClient).mockReturnValue(client as unknown as ReturnType<typeof initEasyCreditClient>);
    jest.mocked(updatePayment).mockImplementation(async (payment) => payment);
    jest.mocked(updateCart).mockImplementation(async (cart) => cart);
  });

  const givenPayment = (payment: ReturnType<typeof buildPayment>) =>
    jest.mocked(getPaymentById).mockResolvedValue(payment as unknown as Awaited<ReturnType<typeof getPaymentById>>);
  const givenCart = (cart: Cart) => jest.mocked(getCartByPaymentId).mockResolvedValue(cart);

  describe('cancel', () => {
    beforeEach(() => {
      client.getPayment.mockResolvedValue({ status: 'OPEN' });
    });

    it('should unfreeze the cart and remove the placeholder the connector added', async () => {
      givenPayment(buildPayment());
      const cart = buildCart();
      givenCart(cart);

      await handleCancelPayment(PAYMENT_ID);

      expect(updatePayment).toHaveBeenCalledWith(expect.anything(), failureWrite);
      expect(updateCart).toHaveBeenCalledWith(cart, [{ action: 'unfreezeCart' }, { action: 'setShippingAddress' }]);
    });

    it('should remove a shipping method set on the placeholder first, as it blocks unsetting the address', async () => {
      givenPayment(buildPayment());
      const cart = buildCart({ shippingInfo: { shippingMethodName: 'Standard' } });
      givenCart(cart);

      await handleCancelPayment(PAYMENT_ID);

      expect(updateCart).toHaveBeenCalledWith(cart, [
        { action: 'unfreezeCart' },
        { action: 'setShippingMethod' },
        { action: 'setShippingAddress' },
      ]);
    });

    it('should keep an address that replaced the placeholder', async () => {
      givenPayment(buildPayment());
      const cart = buildCart({ shippingAddress: address });
      givenCart(cart);

      await handleCancelPayment(PAYMENT_ID);

      expect(updateCart).toHaveBeenCalledWith(cart, [{ action: 'unfreezeCart' }]);
    });

    it('should keep a country-only address the shop set itself', async () => {
      givenPayment(buildPayment({ easyCreditExpress: true, easyCreditExpressPlaceholderAddress: false }));
      const cart = buildCart();
      givenCart(cart);

      await handleCancelPayment(PAYMENT_ID);

      expect(updateCart).toHaveBeenCalledWith(cart, [{ action: 'unfreezeCart' }]);
    });

    it('should do nothing for an attempt a newer one already discarded', async () => {
      givenPayment(buildPayment(EXPRESS_WITH_PLACEHOLDER, 'Failure'));
      // The discard removed the payment from the cart.
      jest.mocked(findCartByPaymentId).mockResolvedValue(undefined);

      await expect(handleCancelPayment(PAYMENT_ID)).resolves.toBe(PAYMENT_ID);

      expect(client.getPayment).not.toHaveBeenCalled();
      expect(updatePayment).not.toHaveBeenCalled();
      expect(updateCart).not.toHaveBeenCalled();
    });

    it('should release the cart on a retry after the release of the first cancel failed', async () => {
      givenPayment(buildPayment());
      const cart = buildCart();
      givenCart(cart);
      jest.mocked(updateCart).mockRejectedValueOnce(new Error('commercetools down'));

      await expect(handleCancelPayment(PAYMENT_ID)).rejects.toThrow('commercetools down');

      givenPayment(buildPayment(EXPRESS_WITH_PLACEHOLDER, 'Failure'));
      await expect(handleCancelPayment(PAYMENT_ID)).resolves.toBe(PAYMENT_ID);

      expect(updateCart).toHaveBeenLastCalledWith(cart, [{ action: 'unfreezeCart' }, { action: 'setShippingAddress' }]);
    });

    it('should keep the cart frozen for a newer open attempt on it', async () => {
      const newer = { ...buildPayment(), id: 'payment-newer' };
      jest
        .mocked(getPaymentById)
        .mockImplementation(
          async (id) =>
            (id === newer.id ? newer : buildPayment(EXPRESS_WITH_PLACEHOLDER, 'Failure')) as unknown as Awaited<
              ReturnType<typeof getPaymentById>
            >,
        );
      givenCart(buildCart({ paymentInfo: { payments: [{ id: PAYMENT_ID }, { id: newer.id }] } }));

      await expect(handleCancelPayment(PAYMENT_ID)).resolves.toBe(PAYMENT_ID);

      expect(updateCart).not.toHaveBeenCalled();
    });

    it('should keep the cart frozen for an authorized attempt on it', async () => {
      const authorized = { ...buildPayment(EXPRESS_WITH_PLACEHOLDER, 'Success'), id: 'payment-authorized' };
      jest
        .mocked(getPaymentById)
        .mockImplementation(
          async (id) =>
            (id === authorized.id
              ? authorized
              : buildPayment(EXPRESS_WITH_PLACEHOLDER, 'Failure')) as unknown as Awaited<
              ReturnType<typeof getPaymentById>
            >,
        );
      givenCart(buildCart({ paymentInfo: { payments: [{ id: PAYMENT_ID }, { id: authorized.id }] } }));

      await expect(handleCancelPayment(PAYMENT_ID)).resolves.toBe(PAYMENT_ID);

      expect(updateCart).not.toHaveBeenCalled();
    });

    it('should still answer when the release for an already failed attempt fails', async () => {
      givenPayment(buildPayment(EXPRESS_WITH_PLACEHOLDER, 'Failure'));
      givenCart(buildCart());
      jest.mocked(updateCart).mockRejectedValueOnce(new Error('commercetools down'));

      await expect(handleCancelPayment(PAYMENT_ID)).resolves.toBe(PAYMENT_ID);
    });

    it('should redirect the shopper for an already discarded attempt instead of answering 400', async () => {
      givenPayment(buildPayment(EXPRESS_WITH_PLACEHOLDER, 'Failure'));
      jest.mocked(findCartByPaymentId).mockResolvedValue(undefined);
      const redirectUrl = 'https://shop.example.com/cart';
      const app = fastify();
      app.setErrorHandler(errorHandler);
      await app.register(webhookRoute, { prefix: '/webhook' });

      try {
        const response = await app.inject({
          method: 'GET',
          url: `/webhook/${PAYMENT_ID}/cancel?redirectUrl=${encodeURIComponent(redirectUrl)}&sig=${signRedirectUrl(PAYMENT_ID, redirectUrl)}`,
        });

        expect(response.statusCode).toBe(302);
        expect(response.headers.location).toBe(redirectUrl);
      } finally {
        await app.close();
      }
    });
  });

  describe('authorize', () => {
    it('should refuse while the placeholder is on the cart, without failing the transaction', async () => {
      givenPayment(buildPayment());
      givenCart(buildCart());
      client.getPayment.mockResolvedValue(preauthorized());

      await expect(getErrorCodes(handleAuthorizeECPayment(PAYMENT_ID))).resolves.toEqual(['ExpressAddressMissing']);

      expect(client.authorizePayment).not.toHaveBeenCalled();
      expect(updatePayment).not.toHaveBeenCalledWith(expect.anything(), failureWrite);
      expect(updateCart).not.toHaveBeenCalled();
    });

    it('should authorize once the express return set a valid address', async () => {
      givenPayment(buildPayment());
      givenCart(buildCart({ billingAddress: address, shippingAddress: address }));
      client.getPayment.mockResolvedValue(preauthorized());

      await handleAuthorizeECPayment(PAYMENT_ID);

      expect(client.authorizePayment).toHaveBeenCalledWith('tech-1', PAYMENT_ID, expect.anything());
    });

    it('should run the address checks for an express installment payment and fail on a definitive error', async () => {
      givenPayment(buildPayment());
      const cart = buildCart({ billingAddress: address, shippingAddress: { ...address, city: 'Hamburg' } });
      givenCart(cart);
      client.getPayment.mockResolvedValue(preauthorized());

      await expect(getErrorCodes(handleAuthorizeECPayment(PAYMENT_ID))).resolves.toEqual(['AddressesUnmatched']);

      expect(client.authorizePayment).not.toHaveBeenCalled();
      expect(updatePayment).toHaveBeenCalledWith(expect.anything(), failureWrite);
      expect(updateCart).toHaveBeenCalledWith(cart, [{ action: 'unfreezeCart' }]);
    });

    it('should fail with InvalidBillingAddress when the express return only set the shipping address', async () => {
      givenPayment(buildPayment());
      const cart = buildCart({ shippingAddress: address });
      givenCart(cart);
      client.getPayment.mockResolvedValue(preauthorized());

      await expect(getErrorCodes(handleAuthorizeECPayment(PAYMENT_ID))).resolves.toEqual(
        expect.arrayContaining(['InvalidBillingAddress']),
      );

      expect(client.authorizePayment).not.toHaveBeenCalled();
      expect(updatePayment).toHaveBeenCalledWith(expect.anything(), failureWrite);
    });

    it('should leave a regular installment payment as it was', async () => {
      givenPayment(buildPayment(null));
      givenCart(buildCart());
      client.getPayment.mockResolvedValue(preauthorized());

      await handleAuthorizeECPayment(PAYMENT_ID);

      expect(client.authorizePayment).toHaveBeenCalled();
    });

    it('should remove the placeholder when easyCredit declined the transaction', async () => {
      givenPayment(buildPayment());
      const cart = buildCart();
      givenCart(cart);
      client.getPayment.mockResolvedValue({ status: 'DECLINED' });

      await expect(getErrorCodes(handleAuthorizeECPayment(PAYMENT_ID))).resolves.toEqual([
        'TransactionNotPreauthorized',
      ]);

      expect(updatePayment).toHaveBeenCalledWith(expect.anything(), failureWrite);
      expect(updateCart).toHaveBeenCalledWith(cart, [{ action: 'unfreezeCart' }, { action: 'setShippingAddress' }]);
    });
  });

  describe('payment type switch on the easyCredit page', () => {
    it('should validate a switch to bill like at create while the placeholder is on the cart', async () => {
      givenPayment(buildPayment());
      givenCart(buildCart());
      client.getPayment.mockResolvedValue(preauthorized('BILL_PAYMENT'));

      const response = await handleGetPayment(PAYMENT_ID);

      expect(response.paymentType).toBe('BILL_PAYMENT');
      expect(updatePayment).not.toHaveBeenCalledWith(expect.anything(), failureWrite);
    });

    it('should still fail a switch to bill for a business unit cart', async () => {
      givenPayment(buildPayment());
      givenCart(buildCart({ businessUnit: { typeId: 'business-unit', key: 'acme' } }));
      client.getPayment.mockResolvedValue(preauthorized('BILL_PAYMENT'));

      await expect(getErrorCodes(handleGetPayment(PAYMENT_ID))).resolves.toEqual(['CorporateCustomerNotAllowed']);

      expect(updatePayment).toHaveBeenCalledWith(expect.anything(), failureWrite);
    });
  });
  describe('abandoned express attempt in the regular checkout', () => {
    const removeAbandoned = [
      { action: 'unfreezeCart' },
      { action: 'setShippingAddress' },
      { action: 'removePayment', payment: { typeId: 'payment', id: PAYMENT_ID } },
    ];
    const regularLinks = {
      urlSuccess: 'https://shop.example.com/success',
      urlCancellation: 'https://shop.example.com/cancel',
      urlDenial: 'https://shop.example.com/denied',
    };
    const shopRelationship = { customerStatus: 'NEW_CUSTOMER' as const, numberOfOrders: 0 };
    const abandonedCart = () => buildCart({ paymentInfo: { payments: [{ id: PAYMENT_ID }] } });

    beforeEach(() => {
      jest.mocked(getCartById).mockResolvedValue(abandonedCart());
    });

    const SESSION = 'cart-1';
    const goneError = new Errorx({ code: 'NotFound', message: 'gone', httpErrorStatus: 410 });

    describe('payment method check', () => {
      it.each([
        ['DECLINED', () => client.getPayment.mockResolvedValue({ status: 'DECLINED' })],
        ['EXPIRED', () => client.getPayment.mockResolvedValue({ status: 'EXPIRED' })],
        ['gone at easyCredit', () => client.getPayment.mockRejectedValue(goneError)],
      ])('should end an attempt that is %s and remove the placeholder', async (_, givenStatus) => {
        givenPayment(buildPayment());
        givenStatus();

        await handlePaymentMethod('cart-1', undefined, { sessionCartId: SESSION }).catch(() => undefined);

        expect(updatePayment).toHaveBeenCalledWith(expect.anything(), failureWrite);
        expect(updateCart).toHaveBeenCalledWith(abandonedCart(), removeAbandoned);
      });

      it.each(['OPEN', 'PREAUTHORIZED', 'AUTHORIZED'])(
        'should keep an attempt that is %s at easyCredit, so the shopper can still finish it',
        async (status) => {
          givenPayment(buildPayment());
          client.getPayment.mockResolvedValue({ status });

          await handlePaymentMethod('cart-1', undefined, { sessionCartId: SESSION }).catch(() => undefined);

          expect(updatePayment).not.toHaveBeenCalled();
          expect(updateCart).not.toHaveBeenCalled();
        },
      );

      it('should keep the attempt when easyCredit cannot be asked', async () => {
        givenPayment(buildPayment());
        client.getPayment.mockRejectedValue(new Errorx({ code: 'Unavailable', message: 'down', httpErrorStatus: 503 }));

        await handlePaymentMethod('cart-1', undefined, { sessionCartId: SESSION }).catch(() => undefined);

        expect(updatePayment).not.toHaveBeenCalled();
        expect(updateCart).not.toHaveBeenCalled();
      });

      it('should keep a Pending attempt', async () => {
        givenPayment(buildPayment(EXPRESS_WITH_PLACEHOLDER, 'Pending'));

        await handlePaymentMethod('cart-1', undefined, { sessionCartId: SESSION }).catch(() => undefined);

        expect(client.getPayment).not.toHaveBeenCalled();
        expect(updateCart).not.toHaveBeenCalled();
      });

      it('should only detach an attempt that has already failed', async () => {
        givenPayment(buildPayment(EXPRESS_WITH_PLACEHOLDER, 'Failure'));

        await handlePaymentMethod('cart-1', undefined, { sessionCartId: SESSION }).catch(() => undefined);

        expect(client.getPayment).not.toHaveBeenCalled();
        expect(updatePayment).not.toHaveBeenCalled();
        expect(updateCart).toHaveBeenCalledWith(abandonedCart(), removeAbandoned);
      });

      it('should leave a country-only address the shop set itself', async () => {
        givenPayment(buildPayment({ easyCreditExpress: true, easyCreditExpressPlaceholderAddress: false }));

        await handlePaymentMethod('cart-1', undefined, { sessionCartId: SESSION }).catch(() => undefined);

        expect(client.getPayment).not.toHaveBeenCalled();
        expect(updateCart).not.toHaveBeenCalled();
      });

      it.each([
        ['another session', 'cart-other'],
        ['no session cart', undefined],
      ])('should not touch a cart of %s', async (_, sessionCartId) => {
        givenPayment(buildPayment());
        client.getPayment.mockResolvedValue({ status: 'DECLINED' });

        await handlePaymentMethod('cart-1', undefined, { sessionCartId }).catch(() => undefined);

        expect(getPaymentById).not.toHaveBeenCalled();
        expect(updatePayment).not.toHaveBeenCalled();
        expect(updateCart).not.toHaveBeenCalled();
      });
    });

    describe('create', () => {
      it.each(['OPEN', 'DECLINED'])('should end an attempt that is %s before a regular create', async (status) => {
        givenPayment(buildPayment());
        client.getPayment.mockResolvedValue({ status });

        await handleCreatePayment('cart-1', regularLinks, shopRelationship, undefined, SESSION).catch(() => undefined);

        expect(updatePayment).toHaveBeenCalledWith(expect.anything(), failureWrite);
        expect(updateCart).toHaveBeenCalledWith(abandonedCart(), removeAbandoned);
      });

      it.each(['PREAUTHORIZED', 'AUTHORIZED'])(
        'should refuse a regular create while the attempt is %s, without writes',
        async (status) => {
          givenPayment(buildPayment());
          client.getPayment.mockResolvedValue({ status });

          await expect(
            getErrorCodes(handleCreatePayment('cart-1', regularLinks, shopRelationship, undefined, SESSION)),
          ).resolves.toEqual(['PaymentInProgress']);

          expect(updatePayment).not.toHaveBeenCalled();
          expect(updateCart).not.toHaveBeenCalled();
        },
      );

      it('should refuse a regular create when the attempt moved on before it could be ended', async () => {
        jest
          .mocked(getPaymentById)
          .mockResolvedValueOnce(buildPayment() as unknown as Awaited<ReturnType<typeof getPaymentById>>)
          .mockResolvedValue(
            buildPayment(EXPRESS_WITH_PLACEHOLDER, 'Pending') as unknown as Awaited<ReturnType<typeof getPaymentById>>,
          );
        client.getPayment.mockResolvedValue({ status: 'OPEN' });

        await expect(
          getErrorCodes(handleCreatePayment('cart-1', regularLinks, shopRelationship, undefined, SESSION)),
        ).resolves.toEqual(['PaymentInProgress']);

        expect(updatePayment).not.toHaveBeenCalled();
        expect(updateCart).not.toHaveBeenCalled();
      });

      it('should not end the attempt of a cart that is not the session cart', async () => {
        givenPayment(buildPayment());
        client.getPayment.mockResolvedValue({ status: 'OPEN' });

        const codes = await getErrorCodes(
          handleCreatePayment('cart-1', regularLinks, shopRelationship, undefined, 'cart-other'),
        );

        expect(codes).not.toContain('PaymentInProgress');
        expect(updatePayment).not.toHaveBeenCalled();
        expect(updateCart).not.toHaveBeenCalled();
      });
    });

    it('should not touch the cart in the express payment method check', async () => {
      givenPayment(buildPayment());
      jest.mocked(isPaymentCustomTypeReady).mockResolvedValue(true);

      await handleExpressPaymentMethod('cart-1').catch(() => undefined);

      expect(getPaymentById).not.toHaveBeenCalled();
      expect(updateCart).not.toHaveBeenCalled();
    });
  });
});
