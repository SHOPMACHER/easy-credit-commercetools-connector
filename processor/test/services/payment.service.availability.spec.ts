import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fastify from 'fastify';
import { Cart, Errorx, MultiErrorx } from '@commercetools/connect-payments-sdk';
import { handleCreatePayment, handlePaymentMethod } from '../../src/services/payment.service';
import { resetWebshopInfoCache } from '../../src/services/webshop.service';
import { getCartById, updateCart } from '../../src/commercetools/cart.commercetools';
import { createPayment, updatePayment } from '../../src/commercetools/payment.commercetools';
import { getCustomObjectByKey } from '../../src/commercetools/customObject.commercetools';
import { getProductTypesByKeys } from '../../src/commercetools/productType.commercetools';
import { resetBillPaymentRestrictionCache } from '../../src/services/billPaymentRestriction.service';
import { log } from '../../src/libs/logger';
import { initEasyCreditClient } from '../../src/client/easycredit.client';
import { ECTransactionCustomerRelationship, ECTransactionPaymentType } from '../../src/types/payment.types';
import { paymentsRoute } from '../../src/routes/payment.route';
import { errorHandler } from '../../src/libs/fastify/error-handler';

// Runs the real service, webshop service, validators and config; only the external APIs are mocked.
jest.mock('../../src/commercetools/cart.commercetools');
jest.mock('../../src/commercetools/payment.commercetools');
jest.mock('../../src/client/easycredit.client');
jest.mock('../../src/commercetools/customObject.commercetools');
jest.mock('../../src/commercetools/productType.commercetools');

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

const physicalItem = { productType: { typeId: 'product-type', id: 'pt-physical' } };
const voucherItem = { productType: { typeId: 'product-type', id: 'pt-voucher' } };

const mockCart = (
  amountInEur: number,
  { lineItems = [physicalItem], customLineItems = [] }: { lineItems?: object[]; customLineItems?: object[] } = {},
) =>
  ({
    id: 'cart123',
    cartState: 'Active',
    billingAddress: address,
    shippingAddress: address,
    lineItems,
    customLineItems,
    totalPrice: { currencyCode: 'EUR', centAmount: amountInEur * 100, fractionDigits: 2 },
  }) as unknown as Cart;

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

const BILL = ECTransactionPaymentType.ECTransactionBillPayment;

const unauthorized = () => new Errorx({ code: 'Unauthorized', message: 'Unauthorized', httpErrorStatus: 401 });

describe('payment type availability', () => {
  let getWebshopInfoMock: jest.Mock<() => Promise<unknown>>;
  let createECPaymentMock: jest.Mock;

  const redirectLinks = {
    urlSuccess: 'https://example.com',
    urlCancellation: 'https://example.com',
    urlDenial: 'https://example.com',
  };

  const mockCreateFlow = (cart: Cart) => {
    jest.mocked(getCartById).mockResolvedValue(cart);
    jest.mocked(updateCart).mockResolvedValue({ ...cart, lineItems: [], cartState: 'Frozen' } as Cart);
    jest.mocked(createPayment).mockResolvedValue({ id: 'payment123' } as Awaited<ReturnType<typeof createPayment>>);
    jest.mocked(updatePayment).mockResolvedValue({ id: 'payment123' } as Awaited<ReturnType<typeof updatePayment>>);
    jest
      .mocked(getCustomObjectByKey)
      .mockResolvedValue({ value: 'https://connector.example.com' } as Awaited<
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
    getWebshopInfoMock = jest.fn<() => Promise<unknown>>().mockResolvedValue(webshopInfo);
    createECPaymentMock = jest.fn();
    (initEasyCreditClient as jest.Mock).mockReturnValue({
      getWebshopInfo: getWebshopInfoMock,
      createPayment: createECPaymentMock,
    });
  });

  describe('handlePaymentMethod', () => {
    it('should reject bill payment when a later Multiple shipping destination has a company', async () => {
      const cart = {
        ...mockCart(500),
        shippingMode: 'Multiple',
        shippingAddress: undefined,
        shipping: [{ shippingAddress: address }, { shippingAddress: { ...address, company: 'ACME GmbH' } }],
      } as unknown as Cart;
      jest.mocked(getCartById).mockResolvedValue(cart);

      await expect(
        getErrorCodes(handlePaymentMethod('cart123', ECTransactionPaymentType.ECTransactionBillPayment)),
      ).resolves.toEqual([{ code: 'CorporateCustomerNotAllowed', httpErrorStatus: 400 }]);
    });

    it('should offer bill payment when all Multiple shipping destinations are private', async () => {
      const cart = {
        ...mockCart(500),
        shippingMode: 'Multiple',
        shippingAddress: undefined,
        shipping: [undefined, '', '  '].map((company) => ({ shippingAddress: { ...address, company } })),
      } as unknown as Cart;
      jest.mocked(getCartById).mockResolvedValue(cart);

      const result = await handlePaymentMethod('cart123', ECTransactionPaymentType.ECTransactionBillPayment);

      expect(result.paymentTypes.BILL_PAYMENT).toEqual({
        enabled: true,
        available: true,
        minAmount: 50,
        maxAmount: 5000,
      });
    });

    it('should return the payment types if installment is available', async () => {
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue(mockCart(500));

      const result = await handlePaymentMethod('cart123');

      expect(result.paymentTypes.INSTALLMENT_PAYMENT).toEqual(
        expect.objectContaining({ available: true, minAmount: 200, maxAmount: 10000 }),
      );
    });

    it('should reject a cart that only bill payment could pay', async () => {
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue(mockCart(100));

      await expect(getErrorCodes(handlePaymentMethod('cart123'))).resolves.toEqual([
        { code: 'InvalidAmount', httpErrorStatus: 400 },
      ]);
    });

    it('should reject a cart if installment is not activated for the webshop', async () => {
      getWebshopInfoMock.mockResolvedValue({ ...webshopInfo, installmentPaymentActive: false });
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue(mockCart(500));

      await expect(getErrorCodes(handlePaymentMethod('cart123'))).resolves.toEqual([
        { code: 'PaymentTypeNotAvailable', httpErrorStatus: 400 },
      ]);
    });

    it.each([
      ['the webshop endpoint rejects the credentials', () => getWebshopInfoMock.mockRejectedValue(unauthorized())],
      ['the webshop endpoint returns null', () => getWebshopInfoMock.mockResolvedValue(null)],
    ])('should return EasyCreditUnavailable if %s', async (_, setup) => {
      setup();
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue(mockCart(500));

      await expect(getErrorCodes(handlePaymentMethod('cart123'))).resolves.toEqual([
        { code: 'EasyCreditUnavailable', httpErrorStatus: 503 },
      ]);
    });

    it('should return the webShopId with EasyCreditUnavailable so the enabler can render the alert', async () => {
      getWebshopInfoMock.mockRejectedValue(unauthorized());
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue(mockCart(500));

      await expect(handlePaymentMethod('cart123')).rejects.toMatchObject({
        code: 'EasyCreditUnavailable',
        fields: { webShopId: '1.de.123123' },
      });
    });

    it('should send Retry-After with EasyCreditUnavailable', async () => {
      getWebshopInfoMock.mockRejectedValue(unauthorized());
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue(mockCart(500));
      const app = await buildApp();

      try {
        const response = await app.inject({ method: 'GET', url: '/payments/payment-method/cart123' });

        expect(response.statusCode).toBe(503);
        expect(response.headers['retry-after']).toBe('30');
      } finally {
        await app.close();
      }
    });

    it.each([
      ['a network error', () => new TypeError('fetch failed')],
      ['a 500 response', () => new Errorx({ code: 'Server Error', message: 'Server Error', httpErrorStatus: 500 })],
    ])('should offer installment with the default limits on %s', async (_, error) => {
      getWebshopInfoMock.mockRejectedValue(error());
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue(mockCart(500));

      const result = await handlePaymentMethod('cart123');

      expect(result.paymentTypes).toEqual({
        INSTALLMENT_PAYMENT: { enabled: true, available: true, minAmount: 200, maxAmount: 10000 },
        BILL_PAYMENT: { enabled: false, available: false },
      });
    });

    it('should keep installment available if easyCredit sends null bill payment fields', async () => {
      getWebshopInfoMock.mockResolvedValue({
        ...webshopInfo,
        billPaymentActive: null,
        minBillingValue: null,
        maxBillingValue: null,
      });
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue(mockCart(500));

      const result = await handlePaymentMethod('cart123');

      expect(result.paymentTypes.INSTALLMENT_PAYMENT.available).toBe(true);
      expect(result.paymentTypes.BILL_PAYMENT.available).toBe(false);
    });
  });

  describe('handleCreatePayment', () => {
    it.each(['Active', 'Frozen'] as const)(
      'should leave a previously %s cart untouched when webshop validation fails',
      async (cartState) => {
        jest.mocked(getCartById).mockResolvedValue({ ...mockCart(500), cartState });
        getWebshopInfoMock.mockRejectedValue(unauthorized());
        const app = await buildApp();

        try {
          const response = await app.inject({
            method: 'POST',
            url: '/payments',
            payload: {
              cartId: 'cart123',
              redirectLinks,
              customerRelationship: { customerStatus: 'NEW_CUSTOMER', numberOfOrders: 0 },
            },
          });

          expect(response.statusCode).toBe(503);
          expect(response.headers['retry-after']).toBe('30');
          expect(response.json().errors).toEqual([
            expect.objectContaining({ code: 'EasyCreditUnavailable', fields: { webShopId: '1.de.123123' } }),
          ]);
          expect(updateCart).not.toHaveBeenCalled();
          expect(createPayment).not.toHaveBeenCalled();
          expect(createECPaymentMock).not.toHaveBeenCalled();
        } finally {
          await app.close();
        }
      },
    );

    it('should create a BILL_PAYMENT transaction over HTTP', async () => {
      mockCreateFlow(mockCart(500));
      const app = await buildApp();

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/payments',
          payload: {
            cartId: 'cart123',
            redirectLinks,
            customerRelationship: { customerStatus: 'NEW_CUSTOMER', numberOfOrders: 0 },
            paymentType: 'BILL_PAYMENT',
          },
        });

        expect(response.statusCode).toBe(201);
        expect(createECPaymentMock).toHaveBeenCalledWith(expect.objectContaining({ paymentType: 'BILL_PAYMENT' }));
        expect(createPayment).toHaveBeenCalledWith(
          expect.objectContaining({
            paymentMethodInfo: expect.objectContaining({
              paymentInterface: 'easycredit',
              method: 'BILL_PAYMENT',
              name: { de: 'easyCredit Rechnung' },
            }),
          }),
        );
      } finally {
        await app.close();
      }
    });

    it('should create an INSTALLMENT_PAYMENT transaction when the payment type is omitted', async () => {
      mockCreateFlow(mockCart(500));

      const result = await handlePaymentMethod('cart123');
      expect(result.paymentTypes.BILL_PAYMENT.available).toBe(true);

      await handleCreatePayment('cart123', redirectLinks, {} as ECTransactionCustomerRelationship);

      expect(createECPaymentMock).toHaveBeenCalledWith(
        expect.objectContaining({ paymentType: 'INSTALLMENT_PAYMENT', paymentSwitchPossible: false }),
      );
      expect(createPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentMethodInfo: expect.objectContaining({
            method: 'INSTALLMENT_PAYMENT',
            name: { de: 'easyCredit Ratenkauf' },
          }),
        }),
      );
    });

    it('should create a BILL_PAYMENT for a cart that only bill payment could pay', async () => {
      mockCreateFlow(mockCart(100));

      await handleCreatePayment('cart123', redirectLinks, {} as ECTransactionCustomerRelationship, BILL);

      expect(createECPaymentMock).toHaveBeenCalledWith(expect.objectContaining({ paymentType: 'BILL_PAYMENT' }));
      expect(updateCart).toHaveBeenNthCalledWith(1, expect.anything(), [
        { action: 'freezeCart', strategy: 'HardFreeze' },
      ]);
    });

    describe.each([
      [
        'BILL_PAYMENT_ENABLED is 0',
        500,
        () => {
          process.env.BILL_PAYMENT_ENABLED = '0';
        },
        'PaymentTypeNotAvailable',
      ],
      [
        'the webshop has bill payment inactive',
        500,
        () => getWebshopInfoMock.mockResolvedValue({ ...webshopInfo, billPaymentActive: false }),
        'PaymentTypeNotAvailable',
      ],
      ['the amount is below the bill limits', 40, () => {}, 'InvalidAmount'],
      ['the amount is above the bill limits', 6000, () => {}, 'InvalidAmount'],
    ])('when %s', (_, amount, setup, code) => {
      const originalBillEnabled = process.env.BILL_PAYMENT_ENABLED;

      afterEach(() => {
        process.env.BILL_PAYMENT_ENABLED = originalBillEnabled;
      });

      it.each(['Active', 'Frozen'] as const)(
        'should reject BILL_PAYMENT and leave a %s cart untouched',
        async (cartState) => {
          setup();
          jest.mocked(getCartById).mockResolvedValue({ ...mockCart(amount), cartState });

          await expect(
            getErrorCodes(handleCreatePayment('cart123', redirectLinks, {} as ECTransactionCustomerRelationship, BILL)),
          ).resolves.toEqual([{ code, httpErrorStatus: 400 }]);
          expect(updateCart).not.toHaveBeenCalled();
          expect(createPayment).not.toHaveBeenCalled();
          expect(createECPaymentMock).not.toHaveBeenCalled();
        },
      );
    });

    it('should keep installment creation working when bill payment is disabled', async () => {
      const original = process.env.BILL_PAYMENT_ENABLED;
      process.env.BILL_PAYMENT_ENABLED = '0';
      mockCreateFlow(mockCart(500));

      try {
        await handleCreatePayment('cart123', redirectLinks, {} as ECTransactionCustomerRelationship);
      } finally {
        process.env.BILL_PAYMENT_ENABLED = original;
      }

      expect(createECPaymentMock).toHaveBeenCalledWith(expect.objectContaining({ paymentType: 'INSTALLMENT_PAYMENT' }));
    });

    it('should not create an easyCredit transaction for a cart that only bill payment could pay', async () => {
      const cart = mockCart(100);
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue(cart);
      // @ts-expect-error mocked
      (updateCart as jest.Mock).mockResolvedValue(cart);

      await expect(
        getErrorCodes(
          handleCreatePayment(
            'cart123',
            {
              urlSuccess: 'https://example.com',
              urlCancellation: 'https://example.com',
              urlDenial: 'https://example.com',
            },
            {} as ECTransactionCustomerRelationship,
          ),
        ),
      ).resolves.toEqual([{ code: 'InvalidAmount', httpErrorStatus: 400 }]);
      // The cart was never frozen, so no unfreeze write either.
      expect(updateCart).not.toHaveBeenCalled();
      expect(createPayment).not.toHaveBeenCalled();
      expect(createECPaymentMock).not.toHaveBeenCalled();
    });
  });
  describe('bill payment exclusion for non-physical items', () => {
    const originalEnv = { ...process.env };

    const createBillPayment = () =>
      handleCreatePayment('cart123', redirectLinks, {} as ECTransactionCustomerRelationship, BILL);

    beforeEach(() => {
      process.env.BILL_PAYMENT_EXCLUDED_PRODUCT_TYPES = 'voucher, gift-card';
      process.env.BILL_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS = 'voucher-item';
      jest
        .mocked(getProductTypesByKeys)
        .mockResolvedValue([{ id: 'pt-voucher', key: 'voucher' }] as Awaited<ReturnType<typeof getProductTypesByKeys>>);
    });

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('should offer bill payment for a cart with only physical products', async () => {
      mockCreateFlow(mockCart(500));

      const result = await handlePaymentMethod('cart123');
      expect(result.paymentTypes.BILL_PAYMENT.available).toBe(true);

      await createBillPayment();
      expect(createECPaymentMock).toHaveBeenCalledWith(expect.objectContaining({ paymentType: 'BILL_PAYMENT' }));
      expect(log.info).not.toHaveBeenCalled();
    });

    describe.each([
      ['a blacklisted product type', { lineItems: [voucherItem] }, ['voucher'], []],
      ['physical products and a voucher', { lineItems: [physicalItem, voucherItem] }, ['voucher'], []],
      ['a custom line item matched by slug', { customLineItems: [{ slug: 'voucher-item' }] }, [], ['voucher-item']],
      [
        'a custom line item matched by key',
        { customLineItems: [{ slug: 'other', key: 'voucher-item' }] },
        [],
        ['other'],
      ],
    ])('for a cart with %s', (_, items, productTypeKeys, customLineItems) => {
      it('should report bill payment as unavailable and keep installment', async () => {
        jest.mocked(getCartById).mockResolvedValue(mockCart(500, items));

        const result = await handlePaymentMethod('cart123');

        expect(result.paymentTypes.BILL_PAYMENT.available).toBe(false);
        expect(result.paymentTypes.INSTALLMENT_PAYMENT.available).toBe(true);
        expect(log.info).toHaveBeenCalledWith('Bill payment is excluded for the cart items', {
          cartId: 'cart123',
          productTypeKeys,
          customLineItems,
        });
      });

      it('should reject BILL_PAYMENT and leave the cart untouched', async () => {
        jest.mocked(getCartById).mockResolvedValue(mockCart(500, items));

        await expect(getErrorCodes(createBillPayment())).resolves.toEqual([
          { code: 'BillPaymentExcludedItems', httpErrorStatus: 400 },
        ]);
        expect(updateCart).not.toHaveBeenCalled();
        expect(createPayment).not.toHaveBeenCalled();
        expect(createECPaymentMock).not.toHaveBeenCalled();
      });
    });

    it('should return the error code and only the webShopId over HTTP', async () => {
      jest.mocked(getCartById).mockResolvedValue(mockCart(500, { lineItems: [voucherItem] }));
      const app = await buildApp();

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/payments',
          payload: {
            cartId: 'cart123',
            redirectLinks,
            customerRelationship: { customerStatus: 'NEW_CUSTOMER', numberOfOrders: 0 },
            paymentType: 'BILL_PAYMENT',
          },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().errors).toEqual([
          expect.objectContaining({ code: 'BillPaymentExcludedItems', fields: { webShopId: '1.de.123123' } }),
        ]);
      } finally {
        await app.close();
      }
    });

    it('should not create the payment if a voucher is added between the check and the freeze', async () => {
      jest.mocked(getCartById).mockResolvedValue(mockCart(500));
      jest
        .mocked(updateCart)
        .mockRejectedValue(new Errorx({ code: 'ConcurrentModification', message: 'conflict', httpErrorStatus: 409 }));

      await expect(getErrorCodes(createBillPayment())).resolves.toEqual([
        { code: 'ConcurrentModification', httpErrorStatus: 409 },
      ]);
      // The freeze failed, so the cart is still active and must not be unfrozen.
      expect(updateCart).toHaveBeenCalledTimes(1);
      expect(updateCart).toHaveBeenCalledWith(expect.anything(), [{ action: 'freezeCart', strategy: 'HardFreeze' }]);
      expect(createPayment).not.toHaveBeenCalled();
      expect(createECPaymentMock).not.toHaveBeenCalled();
    });

    it('should re-validate at payment creation if a voucher was added after the check', async () => {
      jest.mocked(getCartById).mockResolvedValueOnce(mockCart(500));
      const result = await handlePaymentMethod('cart123');
      expect(result.paymentTypes.BILL_PAYMENT.available).toBe(true);

      jest.mocked(getCartById).mockResolvedValueOnce(mockCart(500, { lineItems: [physicalItem, voucherItem] }));

      await expect(getErrorCodes(createBillPayment())).resolves.toEqual([
        { code: 'BillPaymentExcludedItems', httpErrorStatus: 400 },
      ]);
      expect(createECPaymentMock).not.toHaveBeenCalled();
    });

    it('should prefer the exclusion over the bill amount limits', async () => {
      jest.mocked(getCartById).mockResolvedValue(mockCart(40, { lineItems: [voucherItem] }));

      await expect(getErrorCodes(createBillPayment())).resolves.toEqual([
        { code: 'BillPaymentExcludedItems', httpErrorStatus: 400 },
      ]);
    });

    it('should keep installment creation working for a cart with a voucher', async () => {
      mockCreateFlow(mockCart(500, { lineItems: [voucherItem] }));

      await handleCreatePayment('cart123', redirectLinks, {} as ECTransactionCustomerRelationship);

      expect(createECPaymentMock).toHaveBeenCalledWith(expect.objectContaining({ paymentType: 'INSTALLMENT_PAYMENT' }));
    });

    it('should not offer bill payment if the product types cannot be loaded', async () => {
      jest.mocked(getProductTypesByKeys).mockRejectedValue(new Error('insufficient_scope'));
      jest.mocked(getCartById).mockResolvedValue(mockCart(500));

      const result = await handlePaymentMethod('cart123');

      expect(result.paymentTypes.BILL_PAYMENT.available).toBe(false);
      expect(result.paymentTypes.INSTALLMENT_PAYMENT.available).toBe(true);
      await expect(getErrorCodes(createBillPayment())).resolves.toEqual([
        { code: 'BillPaymentCheckFailed', httpErrorStatus: 503 },
      ]);
      expect(log.error).toHaveBeenCalledWith(
        'Failed to check the items of cart cart123 for bill payment, bill payment is not offered',
        expect.any(Error),
      );
    });

    it('should keep the custom line item reason if the product types cannot be loaded', async () => {
      jest.mocked(getProductTypesByKeys).mockRejectedValue(new Error('insufficient_scope'));
      jest
        .mocked(getCartById)
        .mockResolvedValue(mockCart(40, { lineItems: [physicalItem], customLineItems: [{ slug: 'voucher-item' }] }));

      await expect(getErrorCodes(createBillPayment())).resolves.toEqual([
        { code: 'BillPaymentExcludedItems', httpErrorStatus: 400 },
      ]);
      expect(log.info).toHaveBeenCalledWith('Bill payment is excluded for the cart items', {
        cartId: 'cart123',
        productTypeKeys: [],
        customLineItems: ['voucher-item'],
      });
    });

    it('should report a failed lookup instead of the bill amount limits', async () => {
      jest.mocked(getProductTypesByKeys).mockRejectedValue(new Error('insufficient_scope'));
      jest.mocked(getCartById).mockResolvedValue(mockCart(40));

      await expect(getErrorCodes(createBillPayment())).resolves.toEqual([
        { code: 'BillPaymentCheckFailed', httpErrorStatus: 503 },
      ]);
    });

    it('should create an installment payment without the product type lookup', async () => {
      jest.mocked(getProductTypesByKeys).mockRejectedValue(new Error('insufficient_scope'));
      mockCreateFlow(mockCart(500, { lineItems: [voucherItem] }));

      await handleCreatePayment('cart123', redirectLinks, {} as ECTransactionCustomerRelationship);

      expect(createECPaymentMock).toHaveBeenCalledWith(expect.objectContaining({ paymentType: 'INSTALLMENT_PAYMENT' }));
      expect(getProductTypesByKeys).not.toHaveBeenCalled();
      expect(log.error).not.toHaveBeenCalled();
    });

    it('should not load product types while bill payment is disabled', async () => {
      process.env.BILL_PAYMENT_ENABLED = '0';
      jest.mocked(getCartById).mockResolvedValue(mockCart(500, { lineItems: [voucherItem] }));

      await handlePaymentMethod('cart123');

      expect(getProductTypesByKeys).not.toHaveBeenCalled();
    });
  });
});
