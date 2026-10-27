import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fastify from 'fastify';
import { Cart, Errorx, MultiErrorx } from '@commercetools/connect-payments-sdk';
import {
  handleCreateExpressPayment,
  handleCreatePayment,
  handleExpressPaymentMethod,
  handlePaymentMethod,
} from '../../src/services/payment.service';
import { resetWebshopInfoCache } from '../../src/services/webshop.service';
import { getCartById, updateCart } from '../../src/commercetools/cart.commercetools';
import { createPayment, updatePayment } from '../../src/commercetools/payment.commercetools';
import { getCustomObjectByKey } from '../../src/commercetools/customObject.commercetools';
import { getProductTypesByKeys } from '../../src/commercetools/productType.commercetools';
import { resetBillPaymentRestrictionCache } from '../../src/services/billPaymentRestriction.service';
import { initEasyCreditClient } from '../../src/client/easycredit.client';
import { getCartIdFromContext } from '../../src/libs/fastify/context/context';
import { ECTransactionCustomerRelationship, ECTransactionPaymentType } from '../../src/types/payment.types';
import { paymentsRoute } from '../../src/routes/payment.route';
import { errorHandler } from '../../src/libs/fastify/error-handler';

// Runs the real service, validators, mappers and config; only the external APIs and the session are mocked.
jest.mock('../../src/commercetools/cart.commercetools');
jest.mock('../../src/commercetools/payment.commercetools');
jest.mock('../../src/client/easycredit.client');
jest.mock('../../src/commercetools/customObject.commercetools');
jest.mock('../../src/commercetools/productType.commercetools');
jest.mock('../../src/libs/fastify/context/context', () => ({
  ...jest.requireActual<object>('../../src/libs/fastify/context/context'),
  getCartIdFromContext: jest.fn(),
}));

const address = {
  country: 'DE',
  firstName: 'Max',
  lastName: 'Mustermann',
  streetName: 'Hauptstr.',
  city: 'Berlin',
  postalCode: '10115',
};

const webshopInfo = {
  availability: true,
  installmentPaymentActive: true,
  minInstallmentValue: 200,
  maxInstallmentValue: 10000,
  billPaymentActive: true,
  minBillingValue: 50,
  maxBillingValue: 5000,
};

const physicalItem = {
  productType: { typeId: 'product-type', id: 'pt-physical' },
  name: { de: 'Stuhl' },
  quantity: 1,
  price: { value: { centAmount: 50000, fractionDigits: 2 } },
  variant: { sku: 'sku-1' },
};
const voucherItem = { ...physicalItem, productType: { typeId: 'product-type', id: 'pt-voucher' } };

// A PDP or cart express cart: no addresses and no email yet.
const expressCart = (amountInEur: number, overrides: Record<string, unknown> = {}) =>
  ({
    id: 'session-cart',
    cartState: 'Active',
    shipping: [],
    lineItems: [physicalItem],
    customLineItems: [],
    itemShippingAddresses: [],
    totalPrice: { currencyCode: 'EUR', centAmount: amountInEur * 100, fractionDigits: 2 },
    ...overrides,
  }) as unknown as Cart;

const redirectLinks = {
  urlSuccess: 'https://shop.example.com/express/return',
  urlCancellation: 'https://shop.example.com/cart',
  urlDenial: 'https://shop.example.com/cart?denied=1',
};

const BILL = ECTransactionPaymentType.ECTransactionBillPayment;
const INSTALLMENT = ECTransactionPaymentType.ECTransactionInstallmentPayment;

const getErrorCodes = async (promise: Promise<unknown>) => {
  const error = await promise.catch((error: unknown) => error);

  if (error instanceof MultiErrorx) {
    return error.errors.map(({ code, httpErrorStatus }) => ({ code, httpErrorStatus }));
  }
  if (error instanceof Errorx) {
    return [{ code: error.code, httpErrorStatus: error.httpErrorStatus }];
  }

  throw new Error(`Expected an Errorx or MultiErrorx, got ${String(error)}`);
};

const buildApp = async () => {
  const app = fastify();
  app.setErrorHandler(errorHandler);
  const authHook = { authenticate: () => async () => {} };
  await app.register(paymentsRoute, {
    prefix: '/payments',
    sessionHeaderAuthHook: authHook,
    oauth2AuthHook: authHook,
  } as unknown as Parameters<typeof paymentsRoute>[1]);

  return app;
};

describe('express payment creation', () => {
  let createECPaymentMock: jest.Mock;

  const mockCreateFlow = (cart: Cart) => {
    jest.mocked(getCartById).mockResolvedValue(cart);
    jest.mocked(updateCart).mockImplementation(async (current) => ({ ...current, cartState: 'Frozen' }) as Cart);
    jest.mocked(createPayment).mockResolvedValue({ id: 'payment123' } as Awaited<ReturnType<typeof createPayment>>);
    jest.mocked(updatePayment).mockResolvedValue({ id: 'payment123' } as Awaited<ReturnType<typeof updatePayment>>);
    jest
      .mocked(getCustomObjectByKey)
      .mockResolvedValue({ value: 'https://connector.example.com/' } as Awaited<
        ReturnType<typeof getCustomObjectByKey>
      >);
    createECPaymentMock.mockImplementation(async () => ({
      technicalTransactionId: 'tech123',
      transactionId: 'tx123',
      redirectUrl: 'https://easycredit.example.com',
      transactionInformation: { status: 'OPEN', decision: { decisionOutcome: 'POSITIVE', decisionOutcomeText: '' } },
    }));
  };

  beforeEach(() => {
    jest.clearAllMocks();
    resetWebshopInfoCache();
    resetBillPaymentRestrictionCache();
    createECPaymentMock = jest.fn();
    (initEasyCreditClient as jest.Mock).mockReturnValue({
      getWebshopInfo: jest.fn<() => Promise<unknown>>().mockResolvedValue(webshopInfo),
      createPayment: createECPaymentMock,
    });
  });

  describe('handleCreateExpressPayment', () => {
    it.each([INSTALLMENT, BILL])('should create a %s transaction for a cart without addresses', async (paymentType) => {
      mockCreateFlow(expressCart(500));

      const response = await handleCreateExpressPayment('session-cart', redirectLinks, undefined, paymentType);

      expect(response).toEqual(expect.objectContaining({ paymentId: 'payment123', technicalTransactionId: 'tech123' }));
      expect(getCartById).toHaveBeenCalledWith('session-cart');
      expect(updateCart).toHaveBeenCalledWith(expect.anything(), [
        { action: 'setShippingAddress', address: { country: 'DE' } },
        { action: 'freezeCart', strategy: 'HardFreeze' },
      ]);
      expect(createECPaymentMock).toHaveBeenCalledWith(expect.objectContaining({ paymentType }));
    });

    it('should keep an existing shipping address when freezing', async () => {
      mockCreateFlow(expressCart(500, { shippingAddress: address }));

      await handleCreateExpressPayment('session-cart', redirectLinks, undefined, INSTALLMENT);

      expect(updateCart).toHaveBeenCalledWith(expect.anything(), [{ action: 'freezeCart', strategy: 'HardFreeze' }]);
    });

    it('should leave customer, addresses and customer relationship out of the easyCredit transaction', async () => {
      mockCreateFlow(expressCart(500, { billingAddress: address, shippingAddress: address, customerEmail: 'a@b.de' }));

      await handleCreateExpressPayment('session-cart', redirectLinks, undefined, INSTALLMENT);

      const [transaction] = createECPaymentMock.mock.calls[0] as [Record<string, Record<string, unknown>>];
      expect(transaction).not.toHaveProperty('customer');
      expect(transaction).not.toHaveProperty('customerRelationship');
      expect(transaction.orderDetails).not.toHaveProperty('invoiceAddress');
      expect(transaction.orderDetails).not.toHaveProperty('shippingAddress');
      expect(transaction.orderDetails).toEqual(expect.objectContaining({ orderValue: 500, orderId: 'payment123' }));
    });

    it('should send the customer relationship when the shop provides it', async () => {
      mockCreateFlow(expressCart(500));
      const customerRelationship: ECTransactionCustomerRelationship = {
        customerStatus: 'EXISTING_CUSTOMER',
        numberOfOrders: 3,
        orderDoneWithLogin: true,
      };

      await handleCreateExpressPayment('session-cart', redirectLinks, customerRelationship, INSTALLMENT);

      expect(createECPaymentMock).toHaveBeenCalledWith(expect.objectContaining({ customerRelationship }));
    });

    it('should route cancel and denial through the connector so the cart gets unfrozen', async () => {
      mockCreateFlow(expressCart(500));

      await handleCreateExpressPayment('session-cart', redirectLinks, undefined, INSTALLMENT);

      expect(createECPaymentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          redirectLinks: {
            urlSuccess: redirectLinks.urlSuccess,
            urlCancellation: `https://connector.example.com/webhook/payment123/cancel?redirectUrl=${encodeURIComponent(redirectLinks.urlCancellation)}`,
            urlDenial: `https://connector.example.com/webhook/payment123/cancel?redirectUrl=${encodeURIComponent(redirectLinks.urlDenial)}`,
            urlAuthorizationCallback: 'https://connector.example.com/webhook/payment123/authorize',
          },
        }),
      );
    });

    it('should flag the commercetools payment as express', async () => {
      mockCreateFlow(expressCart(500));

      await handleCreateExpressPayment('session-cart', redirectLinks, undefined, BILL);

      expect(createPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentMethodInfo: expect.objectContaining({ method: 'BILL_PAYMENT' }),
          custom: {
            type: { typeId: 'type', key: 'easy-credit-payment' },
            fields: { easyCreditExpress: true },
          },
        }),
      );
    });

    it('should reject a session without a cart before anything is read', async () => {
      await expect(
        getErrorCodes(handleCreateExpressPayment(undefined, redirectLinks, undefined, INSTALLMENT)),
      ).resolves.toEqual([{ code: 'InvalidSession', httpErrorStatus: 400 }]);
      expect(getCartById).not.toHaveBeenCalled();
    });

    it.each([
      ['installment below its limit', INSTALLMENT, 100],
      ['bill above its limit', BILL, 6000],
    ])('should reject %s without freezing the cart', async (_, paymentType, amount) => {
      mockCreateFlow(expressCart(amount));

      await expect(
        getErrorCodes(handleCreateExpressPayment('session-cart', redirectLinks, undefined, paymentType)),
      ).resolves.toEqual([{ code: 'InvalidAmount', httpErrorStatus: 400 }]);
      expect(updateCart).not.toHaveBeenCalled();
      expect(createECPaymentMock).not.toHaveBeenCalled();
    });

    it('should reject a non-EUR cart', async () => {
      mockCreateFlow(expressCart(500, { totalPrice: { currencyCode: 'USD', centAmount: 50000, fractionDigits: 2 } }));

      const codes = await getErrorCodes(
        handleCreateExpressPayment('session-cart', redirectLinks, undefined, INSTALLMENT),
      );

      expect(codes).toEqual([expect.objectContaining({ code: 'InvalidCurrency' })]);
      expect(createECPaymentMock).not.toHaveBeenCalled();
    });

    it('should reject bill payment for a business unit cart', async () => {
      mockCreateFlow(expressCart(500, { businessUnit: { typeId: 'business-unit', key: 'acme' } }));

      await expect(
        getErrorCodes(handleCreateExpressPayment('session-cart', redirectLinks, undefined, BILL)),
      ).resolves.toEqual([{ code: 'CorporateCustomerNotAllowed', httpErrorStatus: 400 }]);
      expect(createECPaymentMock).not.toHaveBeenCalled();
    });

    it('should reject bill payment when it is switched off before the cart is read', async () => {
      const original = process.env.BILL_PAYMENT_ENABLED;
      process.env.BILL_PAYMENT_ENABLED = '0';

      try {
        await expect(
          getErrorCodes(handleCreateExpressPayment('session-cart', redirectLinks, undefined, BILL)),
        ).resolves.toEqual([{ code: 'PaymentTypeNotAvailable', httpErrorStatus: 400 }]);
        expect(getCartById).not.toHaveBeenCalled();
      } finally {
        process.env.BILL_PAYMENT_ENABLED = original;
      }
    });

    it('should re-validate in express mode when freezing reprices the cart', async () => {
      mockCreateFlow(expressCart(500));
      jest
        .mocked(updateCart)
        .mockImplementationOnce(
          async (current) =>
            ({ ...current, cartState: 'Frozen', totalPrice: { ...current.totalPrice, centAmount: 49000 } }) as Cart,
        );

      await handleCreateExpressPayment('session-cart', redirectLinks, undefined, INSTALLMENT);

      expect(createECPaymentMock).toHaveBeenCalledWith(
        expect.objectContaining({ orderDetails: expect.objectContaining({ orderValue: 490 }) }),
      );
    });

    it('should unfreeze the cart and remove the payment when easyCredit rejects the init', async () => {
      mockCreateFlow(expressCart(500));
      createECPaymentMock.mockImplementation(async () => {
        throw new Errorx({ code: 'BadRequest', message: 'rejected', httpErrorStatus: 400 });
      });

      await expect(handleCreateExpressPayment('session-cart', redirectLinks, undefined, INSTALLMENT)).rejects.toThrow(
        'rejected',
      );
      expect(updateCart).toHaveBeenLastCalledWith(expect.objectContaining({ cartState: 'Frozen' }), [
        { action: 'unfreezeCart' },
        { action: 'removePayment', payment: { typeId: 'payment', id: 'payment123' } },
      ]);
    });

    describe('with a bill payment blacklist', () => {
      const originalEnv = { ...process.env };

      beforeEach(() => {
        process.env.BILL_PAYMENT_EXCLUDED_PRODUCT_TYPES = 'voucher';
        jest
          .mocked(getProductTypesByKeys)
          .mockResolvedValue([{ id: 'pt-voucher', key: 'voucher' }] as Awaited<
            ReturnType<typeof getProductTypesByKeys>
          >);
      });

      afterEach(() => {
        process.env = { ...originalEnv };
      });

      it('should reject bill payment for a blacklisted product type', async () => {
        mockCreateFlow(expressCart(500, { lineItems: [voucherItem] }));

        await expect(
          getErrorCodes(handleCreateExpressPayment('session-cart', redirectLinks, undefined, BILL)),
        ).resolves.toEqual([{ code: 'BillPaymentExcludedItems', httpErrorStatus: 400 }]);
        expect(createECPaymentMock).not.toHaveBeenCalled();
      });

      it('should still allow installment for the same cart', async () => {
        mockCreateFlow(expressCart(500, { lineItems: [voucherItem] }));

        await handleCreateExpressPayment('session-cart', redirectLinks, undefined, INSTALLMENT);

        expect(createECPaymentMock).toHaveBeenCalledWith(expect.objectContaining({ paymentType: INSTALLMENT }));
      });
    });
  });

  describe('handleCreatePayment', () => {
    it('should still require addresses and send no express flag', async () => {
      mockCreateFlow(expressCart(500));

      const codes = await getErrorCodes(
        handleCreatePayment('session-cart', redirectLinks, {} as ECTransactionCustomerRelationship, INSTALLMENT),
      );

      expect(codes.map(({ code }) => code)).toEqual(expect.arrayContaining(['InvalidBillingAddress']));
      expect(createPayment).not.toHaveBeenCalled();
    });

    it('should not set a custom type on a regular payment', async () => {
      mockCreateFlow(expressCart(500, { billingAddress: address, shippingAddress: address }));

      await handleCreatePayment('session-cart', redirectLinks, {} as ECTransactionCustomerRelationship, INSTALLMENT);

      expect(createPayment).toHaveBeenCalledWith(expect.not.objectContaining({ custom: expect.anything() }));
      expect(createECPaymentMock).toHaveBeenCalledWith(expect.objectContaining({ customer: expect.anything() }));
    });
  });

  describe('handleExpressPaymentMethod', () => {
    it.each([INSTALLMENT, BILL])('should report the payment types for a cart without addresses (%s)', async (type) => {
      mockCreateFlow(expressCart(500));

      const result = await handleExpressPaymentMethod('session-cart', type);

      expect(getCartById).toHaveBeenCalledWith('session-cart');
      expect(result).toEqual({
        webShopId: '1.de.123123',
        amount: 500,
        paymentTypes: {
          INSTALLMENT_PAYMENT: { enabled: true, available: true, minAmount: 200, maxAmount: 10000 },
          BILL_PAYMENT: { enabled: true, available: true, minAmount: 50, maxAmount: 5000 },
        },
      });
      expect(updateCart).not.toHaveBeenCalled();
    });

    it('should keep the address checks for the regular payment method', async () => {
      mockCreateFlow(expressCart(500));

      const codes = await getErrorCodes(handlePaymentMethod('session-cart', INSTALLMENT));

      expect(codes.map(({ code }) => code)).toEqual(expect.arrayContaining(['InvalidBillingAddress']));
    });

    it('should reject bill payment for a business unit cart', async () => {
      mockCreateFlow(expressCart(500, { businessUnit: { typeId: 'business-unit', key: 'acme' } }));

      await expect(getErrorCodes(handleExpressPaymentMethod('session-cart', BILL))).resolves.toEqual([
        { code: 'CorporateCustomerNotAllowed', httpErrorStatus: 400 },
      ]);
    });

    it('should reject a session without a cart', async () => {
      await expect(getErrorCodes(handleExpressPaymentMethod(undefined, INSTALLMENT))).resolves.toEqual([
        { code: 'InvalidSession', httpErrorStatus: 400 },
      ]);
      expect(getCartById).not.toHaveBeenCalled();
    });
  });

  describe('GET /payments/express/payment-method', () => {
    it('should check the cart of the session', async () => {
      jest.mocked(getCartIdFromContext).mockReturnValue('session-cart');
      mockCreateFlow(expressCart(500));
      const app = await buildApp();

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/payments/express/payment-method?paymentType=BILL_PAYMENT',
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().paymentTypes.BILL_PAYMENT).toEqual({ available: true, minAmount: 50, maxAmount: 5000 });
        expect(getCartById).toHaveBeenCalledWith('session-cart');
      } finally {
        await app.close();
      }
    });

    it('should reject an unknown payment type', async () => {
      const app = await buildApp();

      try {
        const response = await app.inject({ method: 'GET', url: '/payments/express/payment-method?paymentType=CASH' });

        expect(response.statusCode).toBe(400);
        expect(getCartById).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });
  });

  describe('POST /payments/express', () => {
    it('should use the cart of the session and ignore a cartId in the body', async () => {
      jest.mocked(getCartIdFromContext).mockReturnValue('session-cart');
      mockCreateFlow(expressCart(500));
      const app = await buildApp();

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/payments/express',
          payload: { cartId: 'foreign-cart', redirectLinks, paymentType: 'BILL_PAYMENT' },
        });

        expect(response.statusCode).toBe(201);
        expect(response.json()).toEqual(
          expect.objectContaining({ paymentId: 'payment123', redirectUrl: 'https://easycredit.example.com' }),
        );
        expect(getCartById).toHaveBeenCalledTimes(1);
        expect(getCartById).toHaveBeenCalledWith('session-cart');
      } finally {
        await app.close();
      }
    });

    it('should answer 400 when the session has no cart', async () => {
      jest.mocked(getCartIdFromContext).mockReturnValue(undefined as unknown as string);
      const app = await buildApp();

      try {
        const response = await app.inject({ method: 'POST', url: '/payments/express', payload: { redirectLinks } });

        expect(response.statusCode).toBe(400);
        expect(response.json().errors).toEqual([expect.objectContaining({ code: 'InvalidSession' })]);
        expect(getCartById).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });

    it('should answer 400 without redirect links', async () => {
      const app = await buildApp();

      try {
        const response = await app.inject({ method: 'POST', url: '/payments/express', payload: {} });

        expect(response.statusCode).toBe(400);
        expect(getCartById).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });
  });
});
