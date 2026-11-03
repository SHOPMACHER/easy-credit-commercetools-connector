import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import fastify from 'fastify';
import { Cart, Errorx, MultiErrorx } from '@commercetools/connect-payments-sdk';
import { handleAuthorizeECPayment, handleCancelPayment, handleGetPayment } from '../../src/services/payment.service';
import { resetWebshopInfoCache } from '../../src/services/webshop.service';
import { getCartByPaymentId, updateCart } from '../../src/commercetools/cart.commercetools';
import { getPaymentById, updatePayment } from '../../src/commercetools/payment.commercetools';
import { initEasyCreditClient } from '../../src/client/easycredit.client';
import { webhookRoute } from '../../src/routes/webhook.route';
import { errorHandler } from '../../src/libs/fastify/error-handler';

// Runs the real service and validators; only the external APIs are mocked.
jest.mock('../../src/commercetools/cart.commercetools');
jest.mock('../../src/commercetools/payment.commercetools');
jest.mock('../../src/client/easycredit.client');
jest.mock('../../src/commercetools/customObject.commercetools');
jest.mock('../../src/commercetools/productType.commercetools');

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

      await expect(handleCancelPayment(PAYMENT_ID)).resolves.toBe(PAYMENT_ID);

      expect(client.getPayment).not.toHaveBeenCalled();
      expect(updatePayment).not.toHaveBeenCalled();
      expect(updateCart).not.toHaveBeenCalled();
    });

    it('should redirect the shopper for an already discarded attempt instead of answering 400', async () => {
      givenPayment(buildPayment(EXPRESS_WITH_PLACEHOLDER, 'Failure'));
      const app = fastify();
      app.setErrorHandler(errorHandler);
      await app.register(webhookRoute, { prefix: '/webhook' });

      try {
        const response = await app.inject({
          method: 'GET',
          url: `/webhook/${PAYMENT_ID}/cancel?redirectUrl=${encodeURIComponent('https://shop.example.com/cart')}`,
        });

        expect(response.statusCode).toBe(302);
        expect(response.headers.location).toBe('https://shop.example.com/cart');
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
});
