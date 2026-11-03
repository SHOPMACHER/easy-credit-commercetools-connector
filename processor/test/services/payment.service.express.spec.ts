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
import { createPayment, getPaymentById, updatePayment } from '../../src/commercetools/payment.commercetools';
import { isPaymentCustomTypeReady } from '../../src/commercetools/customFields.commercetools';
import { getOrderHistoryOfCustomer } from '../../src/commercetools/order.commercetools';
import { getCustomerSince } from '../../src/commercetools/customer.commercetools';
import { getCustomObjectByKey } from '../../src/commercetools/customObject.commercetools';
import { getProductTypesByKeys } from '../../src/commercetools/productType.commercetools';
import { resetPaymentTypeRestrictionCache } from '../../src/services/paymentTypeRestriction.service';
import { initEasyCreditClient } from '../../src/client/easycredit.client';
import { signRedirectUrl } from '../../src/utils/redirect.utils';
import { getCartIdFromContext } from '../../src/libs/fastify/context/context';
import { ECTransactionCustomerRelationship, ECTransactionPaymentType } from '../../src/types/payment.types';
import { paymentsRoute } from '../../src/routes/payment.route';
import { errorHandler } from '../../src/libs/fastify/error-handler';

// Runs the real service, validators, mappers and config; only the external APIs and the session are mocked.
// What a shop sends in the regular create body; the connector passes it on unchanged.
const shopRelationship = { customerStatus: 'NEW_CUSTOMER' as const, customerSince: '2024-01-01', numberOfOrders: 0 };

jest.mock('../../src/commercetools/cart.commercetools');
jest.mock('../../src/commercetools/payment.commercetools');
jest.mock('../../src/client/easycredit.client');
jest.mock('../../src/commercetools/customObject.commercetools');
jest.mock('../../src/commercetools/productType.commercetools');
jest.mock('../../src/commercetools/customFields.commercetools');
jest.mock('../../src/commercetools/order.commercetools');
jest.mock('../../src/commercetools/customer.commercetools');
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

// Applies the cart actions the service sends, so later steps see the updated cart.
const applyCartActions = async (current: Cart, actions: { action: string; address?: unknown }[]) =>
  actions.reduce<Record<string, unknown>>(
    (cart, action) => {
      switch (action.action) {
        case 'freezeCart':
          return { ...cart, cartState: 'Frozen' };
        case 'unfreezeCart':
          return { ...cart, cartState: 'Active' };
        case 'setShippingAddress':
          return { ...cart, shippingAddress: action.address };
        default:
          return cart;
      }
    },
    { ...current },
  ) as unknown as Cart;

const guestRelationship = { numberOfOrders: 0, orderDoneWithLogin: false };

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
    authorizationHook: { authorize: () => async () => {} },
  } as unknown as Parameters<typeof paymentsRoute>[1]);

  return app;
};

describe('express payment creation', () => {
  let createECPaymentMock: jest.Mock;
  let getECPaymentMock: jest.Mock;

  const mockCreateFlow = (cart: Cart) => {
    jest.mocked(getCartById).mockResolvedValue(cart);
    jest.mocked(updateCart).mockImplementation(applyCartActions as unknown as typeof updateCart);
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
    resetPaymentTypeRestrictionCache();
    createECPaymentMock = jest.fn();
    getECPaymentMock = jest.fn();
    (initEasyCreditClient as jest.Mock).mockReturnValue({
      getWebshopInfo: jest.fn<() => Promise<unknown>>().mockResolvedValue(webshopInfo),
      createPayment: createECPaymentMock,
      getPayment: getECPaymentMock,
    });
    jest.mocked(isPaymentCustomTypeReady).mockResolvedValue(true);
  });

  describe('handleCreateExpressPayment', () => {
    it.each([INSTALLMENT, BILL])('should create a %s transaction for a cart without addresses', async (paymentType) => {
      mockCreateFlow(expressCart(500));

      const response = await handleCreateExpressPayment('session-cart', redirectLinks, paymentType);

      expect(response).toEqual(expect.objectContaining({ paymentId: 'payment123', technicalTransactionId: 'tech123' }));
      expect(getCartById).toHaveBeenCalledWith('session-cart');
      expect(updateCart).toHaveBeenCalledWith(expect.anything(), [
        { action: 'setShippingAddress', address: { country: 'DE' } },
        { action: 'freezeCart' },
      ]);
      expect(createECPaymentMock).toHaveBeenCalledWith(expect.objectContaining({ paymentType }));
    });

    it('should keep an existing shipping address when freezing', async () => {
      mockCreateFlow(expressCart(500, { shippingAddress: address }));

      await handleCreateExpressPayment('session-cart', redirectLinks, INSTALLMENT);

      expect(updateCart).toHaveBeenCalledWith(expect.anything(), [{ action: 'freezeCart' }]);
    });

    it('should leave customer and addresses out of the easyCredit transaction', async () => {
      mockCreateFlow(expressCart(500, { billingAddress: address, shippingAddress: address, customerEmail: 'a@b.de' }));

      await handleCreateExpressPayment('session-cart', redirectLinks, INSTALLMENT);

      const [transaction] = createECPaymentMock.mock.calls[0] as [Record<string, Record<string, unknown>>];
      expect(transaction).not.toHaveProperty('customer');
      expect(transaction.orderDetails).not.toHaveProperty('invoiceAddress');
      expect(transaction.orderDetails).not.toHaveProperty('shippingAddress');
      expect(transaction.orderDetails).toEqual(expect.objectContaining({ orderValue: 500, orderId: 'payment123' }));
    });

    it('should send a guest without history and without asking commercetools', async () => {
      mockCreateFlow(expressCart(500));

      await handleCreateExpressPayment('session-cart', redirectLinks, INSTALLMENT);

      expect(createECPaymentMock).toHaveBeenCalledWith(
        expect.objectContaining({ customerRelationship: guestRelationship }),
      );
      expect(getOrderHistoryOfCustomer).not.toHaveBeenCalled();
      expect(getCustomerSince).not.toHaveBeenCalled();
    });

    it('should send the shipping method as logisticsServiceProvider, like the TeamBank plugins', async () => {
      mockCreateFlow(expressCart(500, { shippingInfo: { shippingMethodName: ' DHL Paket ' } }));

      await handleCreateExpressPayment('session-cart', redirectLinks, INSTALLMENT);

      expect(createECPaymentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          customerRelationship: { ...guestRelationship, logisticsServiceProvider: 'DHL Paket' },
        }),
      );
    });

    it('should cut a shipping method name longer than easyCredit allows', async () => {
      mockCreateFlow(expressCart(500, { shippingInfo: { shippingMethodName: 'x'.repeat(300) } }));

      await handleCreateExpressPayment('session-cart', redirectLinks, INSTALLMENT);

      expect(createECPaymentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          customerRelationship: { ...guestRelationship, logisticsServiceProvider: 'x'.repeat(255) },
        }),
      );
    });

    describe('for a logged-in customer', () => {
      const missingScope = Object.assign(new Error('insufficient_scope'), { statusCode: 403 });

      const expectRelationship = (customerRelationship: ECTransactionCustomerRelationship) =>
        expect(createECPaymentMock).toHaveBeenCalledWith(expect.objectContaining({ customerRelationship }));

      beforeEach(() => {
        mockCreateFlow(expressCart(500, { customerId: 'customer-1' }));
      });

      it('should send the account date and the number of orders, like the TeamBank plugins', async () => {
        jest.mocked(getCustomerSince).mockResolvedValue('2020-05-01');
        jest.mocked(getOrderHistoryOfCustomer).mockResolvedValue({ numberOfOrders: 3, firstOrderDate: '2021-02-03' });

        await handleCreateExpressPayment('session-cart', redirectLinks, INSTALLMENT);

        expect(getCustomerSince).toHaveBeenCalledWith('customer-1');
        expect(getOrderHistoryOfCustomer).toHaveBeenCalledWith('customer-1');
        expectRelationship({ orderDoneWithLogin: true, numberOfOrders: 3, customerSince: '2020-05-01' });
      });

      it('should add the shipping method for a logged-in customer too', async () => {
        mockCreateFlow(
          expressCart(500, { customerId: 'customer-1', shippingInfo: { shippingMethodName: 'Standard' } }),
        );
        jest.mocked(getCustomerSince).mockResolvedValue('2020-05-01');
        jest.mocked(getOrderHistoryOfCustomer).mockResolvedValue({ numberOfOrders: 3, firstOrderDate: '2021-02-03' });

        await handleCreateExpressPayment('session-cart', redirectLinks, INSTALLMENT);

        expectRelationship({
          orderDoneWithLogin: true,
          numberOfOrders: 3,
          customerSince: '2020-05-01',
          logisticsServiceProvider: 'Standard',
        });
      });

      it('should use the first order date without the view_customers scope', async () => {
        jest.mocked(getCustomerSince).mockRejectedValue(missingScope);
        jest.mocked(getOrderHistoryOfCustomer).mockResolvedValue({ numberOfOrders: 3, firstOrderDate: '2021-02-03' });

        await handleCreateExpressPayment('session-cart', redirectLinks, INSTALLMENT);

        expectRelationship({ orderDoneWithLogin: true, numberOfOrders: 3, customerSince: '2021-02-03' });
      });

      it('should use today without the scope and without orders, as easyCredit needs customerSince for a login', async () => {
        jest.useFakeTimers({ now: new Date('2026-11-03T10:00:00Z'), doNotFake: ['setTimeout', 'setImmediate'] });
        jest.mocked(getCustomerSince).mockRejectedValue(new Error('CT down'));
        jest.mocked(getOrderHistoryOfCustomer).mockResolvedValue({ numberOfOrders: 0 });

        try {
          await handleCreateExpressPayment('session-cart', redirectLinks, INSTALLMENT);
        } finally {
          jest.useRealTimers();
        }

        expectRelationship({ orderDoneWithLogin: true, numberOfOrders: 0, customerSince: '2026-11-03' });
      });

      it('should send 0 orders when the orders cannot be read', async () => {
        jest.mocked(getCustomerSince).mockResolvedValue('2020-05-01');
        jest.mocked(getOrderHistoryOfCustomer).mockRejectedValue(new Error('CT down'));

        await handleCreateExpressPayment('session-cart', redirectLinks, INSTALLMENT);

        expectRelationship({ orderDoneWithLogin: true, numberOfOrders: 0, customerSince: '2020-05-01' });
      });
    });

    it('should route cancel and denial through the connector so the cart gets unfrozen', async () => {
      mockCreateFlow(expressCart(500));

      await handleCreateExpressPayment('session-cart', redirectLinks, INSTALLMENT);

      expect(createECPaymentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          redirectLinks: {
            urlSuccess: redirectLinks.urlSuccess,
            urlCancellation:
              `https://connector.example.com/webhook/payment123/cancel?redirectUrl=${encodeURIComponent(redirectLinks.urlCancellation)}` +
              `&successUrl=${encodeURIComponent(redirectLinks.urlSuccess)}` +
              `&sig=${signRedirectUrl('payment123', redirectLinks.urlCancellation, redirectLinks.urlSuccess)}`,
            urlDenial:
              `https://connector.example.com/webhook/payment123/cancel?redirectUrl=${encodeURIComponent(redirectLinks.urlDenial)}` +
              `&successUrl=${encodeURIComponent(redirectLinks.urlSuccess)}` +
              `&sig=${signRedirectUrl('payment123', redirectLinks.urlDenial, redirectLinks.urlSuccess)}`,
            urlAuthorizationCallback: 'https://connector.example.com/webhook/payment123/authorize',
          },
        }),
      );
    });

    it('should flag the commercetools payment as express and record the placeholder', async () => {
      mockCreateFlow(expressCart(500));

      await handleCreateExpressPayment('session-cart', redirectLinks, BILL);

      expect(createPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentMethodInfo: expect.objectContaining({ method: 'BILL_PAYMENT' }),
          custom: {
            type: { typeId: 'type', key: 'easy-credit-payment' },
            fields: { easyCreditExpress: true, easyCreditExpressPlaceholderAddress: true },
          },
        }),
      );
    });

    it('should not record a placeholder when the cart already has a shipping address', async () => {
      mockCreateFlow(expressCart(500, { shippingAddress: { country: 'DE' } }));

      await handleCreateExpressPayment('session-cart', redirectLinks, INSTALLMENT);

      expect(createPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          custom: expect.objectContaining({
            fields: { easyCreditExpress: true, easyCreditExpressPlaceholderAddress: false },
          }),
        }),
      );
    });

    it('should refuse express before the cart changes while post-deploy has not created the payment type', async () => {
      mockCreateFlow(expressCart(500));
      jest.mocked(isPaymentCustomTypeReady).mockResolvedValue(false);

      await expect(
        getErrorCodes(handleCreateExpressPayment('session-cart', redirectLinks, INSTALLMENT)),
      ).resolves.toEqual([{ code: 'ExpressNotConfigured', httpErrorStatus: 503 }]);
      expect(isPaymentCustomTypeReady).toHaveBeenCalledWith('easy-credit-payment');
      expect(getCartById).not.toHaveBeenCalled();
      expect(updateCart).not.toHaveBeenCalled();
    });

    it('should reject a cart with shipping mode Multiple before freezing', async () => {
      mockCreateFlow(expressCart(500, { shippingMode: 'Multiple' }));

      await expect(
        getErrorCodes(handleCreateExpressPayment('session-cart', redirectLinks, INSTALLMENT)),
      ).resolves.toEqual([{ code: 'ExpressShippingModeNotSupported', httpErrorStatus: 400 }]);
      expect(updateCart).not.toHaveBeenCalled();
    });

    describe('with an earlier express attempt on the cart', () => {
      const placeholder = { country: 'DE' };
      const earlierAttempt = (fields: Record<string, boolean>) => ({
        id: 'earlier-payment',
        version: 1,
        paymentMethodInfo: { paymentInterface: 'easycredit', method: 'easycredit' },
        custom: { fields },
        transactions: [
          {
            id: 'earlier-tx',
            type: 'Authorization',
            state: 'Initial',
            interactionId: 'ec-earlier',
            amount: { centAmount: 50000, currencyCode: 'EUR', fractionDigits: 2 },
            custom: { fields: { easyCreditTechnicalTransactionId: 'tech-earlier' } },
          },
        ],
      });
      const cartWithEarlierAttempt = () =>
        expressCart(500, {
          cartState: 'Frozen',
          freezeStrategy: 'SoftFreeze',
          shippingAddress: placeholder,
          paymentInfo: { payments: [{ typeId: 'payment', id: 'earlier-payment' }] },
        });

      beforeEach(() => {
        getECPaymentMock.mockImplementation(async () => ({ status: 'OPEN' }));
      });

      it('should discard it and keep its placeholder for the new attempt', async () => {
        mockCreateFlow(cartWithEarlierAttempt());
        jest
          .mocked(getPaymentById)
          .mockResolvedValue(
            earlierAttempt({ easyCreditExpress: true, easyCreditExpressPlaceholderAddress: true }) as never,
          );

        await handleCreateExpressPayment('session-cart', redirectLinks, INSTALLMENT);

        expect(updatePayment).toHaveBeenCalledWith(expect.objectContaining({ id: 'earlier-payment' }), [
          { action: 'changeTransactionState', transactionId: 'earlier-tx', state: 'Failure' },
        ]);
        expect(updateCart).toHaveBeenCalledWith(expect.anything(), [
          { action: 'unfreezeCart' },
          { action: 'removePayment', payment: { typeId: 'payment', id: 'earlier-payment' } },
          { action: 'freezeCart', strategy: 'SoftFreeze' },
        ]);
        expect(createPayment).toHaveBeenCalledWith(
          expect.objectContaining({
            custom: expect.objectContaining({
              fields: { easyCreditExpress: true, easyCreditExpressPlaceholderAddress: true },
            }),
          }),
        );
      });

      it('should remove the inherited placeholder when the new attempt fails', async () => {
        mockCreateFlow(cartWithEarlierAttempt());
        jest
          .mocked(getPaymentById)
          .mockResolvedValue(
            earlierAttempt({ easyCreditExpress: true, easyCreditExpressPlaceholderAddress: true }) as never,
          );
        createECPaymentMock.mockImplementation(async () => {
          throw new Errorx({ code: 'BadRequest', message: 'rejected', httpErrorStatus: 400 });
        });

        await expect(handleCreateExpressPayment('session-cart', redirectLinks, INSTALLMENT)).rejects.toThrow(
          'rejected',
        );
        expect(updateCart).toHaveBeenLastCalledWith(expect.objectContaining({ cartState: 'Frozen' }), [
          { action: 'unfreezeCart' },
          { action: 'setShippingAddress' },
          { action: 'removePayment', payment: { typeId: 'payment', id: 'payment123' } },
        ]);
      });

      it('should not take over an address the earlier attempt did not add', async () => {
        mockCreateFlow(cartWithEarlierAttempt());
        jest
          .mocked(getPaymentById)
          .mockResolvedValue(
            earlierAttempt({ easyCreditExpress: true, easyCreditExpressPlaceholderAddress: false }) as never,
          );

        await handleCreateExpressPayment('session-cart', redirectLinks, INSTALLMENT);

        expect(createPayment).toHaveBeenCalledWith(
          expect.objectContaining({
            custom: expect.objectContaining({
              fields: { easyCreditExpress: true, easyCreditExpressPlaceholderAddress: false },
            }),
          }),
        );
      });
    });

    it('should reject a session without a cart before anything is read', async () => {
      await expect(getErrorCodes(handleCreateExpressPayment(undefined, redirectLinks, INSTALLMENT))).resolves.toEqual([
        { code: 'InvalidSession', httpErrorStatus: 400 },
      ]);
      expect(getCartById).not.toHaveBeenCalled();
    });

    it.each([
      ['installment below its limit', INSTALLMENT, 100],
      ['bill above its limit', BILL, 6000],
    ])('should reject %s without freezing the cart', async (_, paymentType, amount) => {
      mockCreateFlow(expressCart(amount));

      await expect(
        getErrorCodes(handleCreateExpressPayment('session-cart', redirectLinks, paymentType)),
      ).resolves.toEqual([{ code: 'InvalidAmount', httpErrorStatus: 400 }]);
      expect(updateCart).not.toHaveBeenCalled();
      expect(createECPaymentMock).not.toHaveBeenCalled();
    });

    it('should reject a non-EUR cart', async () => {
      mockCreateFlow(expressCart(500, { totalPrice: { currencyCode: 'USD', centAmount: 50000, fractionDigits: 2 } }));

      const codes = await getErrorCodes(handleCreateExpressPayment('session-cart', redirectLinks, INSTALLMENT));

      expect(codes).toEqual([expect.objectContaining({ code: 'InvalidCurrency' })]);
      expect(createECPaymentMock).not.toHaveBeenCalled();
    });

    it('should reject bill payment for a business unit cart', async () => {
      mockCreateFlow(expressCart(500, { businessUnit: { typeId: 'business-unit', key: 'acme' } }));

      await expect(getErrorCodes(handleCreateExpressPayment('session-cart', redirectLinks, BILL))).resolves.toEqual([
        { code: 'CorporateCustomerNotAllowed', httpErrorStatus: 400 },
      ]);
      expect(createECPaymentMock).not.toHaveBeenCalled();
    });

    it('should reject bill payment when it is switched off before the cart is read', async () => {
      const original = process.env.BILL_PAYMENT_ENABLED;
      process.env.BILL_PAYMENT_ENABLED = '0';

      try {
        await expect(getErrorCodes(handleCreateExpressPayment('session-cart', redirectLinks, BILL))).resolves.toEqual([
          { code: 'PaymentTypeNotAvailable', httpErrorStatus: 400 },
        ]);
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

      await handleCreateExpressPayment('session-cart', redirectLinks, INSTALLMENT);

      expect(createECPaymentMock).toHaveBeenCalledWith(
        expect.objectContaining({ orderDetails: expect.objectContaining({ orderValue: 490 }) }),
      );
    });

    it('should unfreeze the cart, remove the placeholder and the payment when easyCredit rejects the init', async () => {
      mockCreateFlow(expressCart(500));
      createECPaymentMock.mockImplementation(async () => {
        throw new Errorx({ code: 'BadRequest', message: 'rejected', httpErrorStatus: 400 });
      });

      await expect(handleCreateExpressPayment('session-cart', redirectLinks, INSTALLMENT)).rejects.toThrow('rejected');
      expect(updateCart).toHaveBeenLastCalledWith(expect.objectContaining({ cartState: 'Frozen' }), [
        { action: 'unfreezeCart' },
        { action: 'setShippingAddress' },
        { action: 'removePayment', payment: { typeId: 'payment', id: 'payment123' } },
      ]);
    });

    it('should keep a shipping address the shop set when easyCredit rejects the init', async () => {
      mockCreateFlow(expressCart(500, { shippingAddress: { country: 'DE' } }));
      createECPaymentMock.mockImplementation(async () => {
        throw new Errorx({ code: 'BadRequest', message: 'rejected', httpErrorStatus: 400 });
      });

      await expect(handleCreateExpressPayment('session-cart', redirectLinks, INSTALLMENT)).rejects.toThrow('rejected');
      expect(updateCart).toHaveBeenLastCalledWith(expect.anything(), [
        { action: 'unfreezeCart' },
        { action: 'removePayment', payment: { typeId: 'payment', id: 'payment123' } },
      ]);
    });

    it('should remove the placeholder when the payment type is missing at payment creation', async () => {
      mockCreateFlow(expressCart(500));
      jest
        .mocked(createPayment)
        .mockRejectedValue(new Errorx({ code: 'InvalidInput', message: 'no type', httpErrorStatus: 400 }));

      await expect(handleCreateExpressPayment('session-cart', redirectLinks, INSTALLMENT)).rejects.toThrow('no type');
      expect(updateCart).toHaveBeenLastCalledWith(expect.anything(), [
        { action: 'unfreezeCart' },
        { action: 'setShippingAddress' },
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

        await expect(getErrorCodes(handleCreateExpressPayment('session-cart', redirectLinks, BILL))).resolves.toEqual([
          { code: 'BillPaymentExcludedItems', httpErrorStatus: 400 },
        ]);
        expect(createECPaymentMock).not.toHaveBeenCalled();
      });

      it('should still allow installment for the same cart', async () => {
        mockCreateFlow(expressCart(500, { lineItems: [voucherItem] }));

        await handleCreateExpressPayment('session-cart', redirectLinks, INSTALLMENT);

        expect(createECPaymentMock).toHaveBeenCalledWith(expect.objectContaining({ paymentType: INSTALLMENT }));
      });
    });
  });

  describe('handleCreatePayment', () => {
    it('should still require addresses and send no express flag', async () => {
      mockCreateFlow(expressCart(500));

      const codes = await getErrorCodes(
        handleCreatePayment('session-cart', redirectLinks, shopRelationship, INSTALLMENT),
      );

      expect(codes.map(({ code }) => code)).toEqual(expect.arrayContaining(['InvalidBillingAddress']));
      expect(createPayment).not.toHaveBeenCalled();
    });

    it('should not set a custom type on a regular payment', async () => {
      mockCreateFlow(expressCart(500, { billingAddress: address, shippingAddress: address }));

      await handleCreatePayment('session-cart', redirectLinks, shopRelationship, INSTALLMENT);

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

    it('should report a missing payment type, so the shop hides the express buttons', async () => {
      mockCreateFlow(expressCart(500));
      jest.mocked(isPaymentCustomTypeReady).mockResolvedValue(false);

      await expect(getErrorCodes(handleExpressPaymentMethod('session-cart', INSTALLMENT))).resolves.toEqual([
        { code: 'ExpressNotConfigured', httpErrorStatus: 503 },
      ]);
    });

    it('should report shipping mode Multiple as not supported', async () => {
      mockCreateFlow(expressCart(500, { shippingMode: 'Multiple' }));

      await expect(getErrorCodes(handleExpressPaymentMethod('session-cart', INSTALLMENT))).resolves.toEqual([
        { code: 'ExpressShippingModeNotSupported', httpErrorStatus: 400 },
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

    it('should ignore a customerRelationship in the body and send the derived one', async () => {
      jest.mocked(getCartIdFromContext).mockReturnValue('session-cart');
      mockCreateFlow(expressCart(500));
      const app = await buildApp();

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/payments/express',
          payload: {
            redirectLinks,
            customerRelationship: { customerStatus: 'PREMIUM_CUSTOMER', numberOfOrders: 99 },
          },
        });

        expect(response.statusCode).toBe(201);
        expect(createECPaymentMock).toHaveBeenCalledWith(
          expect.objectContaining({ customerRelationship: guestRelationship }),
        );
      } finally {
        await app.close();
      }
    });

    it.each([
      ['an unknown payment type', { redirectLinks, paymentType: 'CASH' }, 'InvalidJsonInput'],
      ['a relative urlSuccess', { redirectLinks: { ...redirectLinks, urlSuccess: '/express/return' } }, 'InvalidField'],
      [
        'a non-http urlCancellation',
        { redirectLinks: { ...redirectLinks, urlCancellation: 'ftp://shop.example.com/cart' } },
        'InvalidField',
      ],
      [
        'a urlSuccess with a user name that hides the real host',
        { redirectLinks: { ...redirectLinks, urlSuccess: 'https://shop.example.com@evil.example.com/return' } },
        'InvalidField',
      ],
      [
        'a urlDenial with user name and password',
        { redirectLinks: { ...redirectLinks, urlDenial: 'https://user:secret@shop.example.com/denied' } },
        'InvalidField',
      ],
      [
        'a mailto urlSuccess',
        { redirectLinks: { ...redirectLinks, urlSuccess: 'mailto:shop@example.com' } },
        'InvalidField',
      ],
    ])('should answer 400 for %s before the cart is read', async (_, payload, code) => {
      jest.mocked(getCartIdFromContext).mockReturnValue('session-cart');
      const app = await buildApp();

      try {
        const response = await app.inject({ method: 'POST', url: '/payments/express', payload });

        expect(response.statusCode).toBe(400);
        expect(response.json().errors).toEqual([expect.objectContaining({ code })]);
        expect(getCartById).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });

    it('should answer 503 with ExpressNotConfigured while the payment type is missing', async () => {
      jest.mocked(getCartIdFromContext).mockReturnValue('session-cart');
      jest.mocked(isPaymentCustomTypeReady).mockResolvedValue(false);
      const app = await buildApp();

      try {
        const response = await app.inject({ method: 'POST', url: '/payments/express', payload: { redirectLinks } });

        expect(response.statusCode).toBe(503);
        expect(response.json().errors).toEqual([expect.objectContaining({ code: 'ExpressNotConfigured' })]);
      } finally {
        await app.close();
      }
    });

    it('should answer 400 without redirect links', async () => {
      const app = await buildApp();

      try {
        const response = await app.inject({ method: 'POST', url: '/payments/express', payload: {} });

        expect(response.statusCode).toBe(400);
        expect(response.json().errors).toEqual([expect.objectContaining({ code: 'RequiredField' })]);
        expect(getCartById).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });
  });
});
