import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import fastify from 'fastify';
import { Cart, Errorx, MultiErrorx } from '@commercetools/connect-payments-sdk';
import { handleCreatePayment, handlePaymentMethod } from '../../src/services/payment.service';
import { resetWebshopInfoCache } from '../../src/services/webshop.service';
import { getCartById, updateCart } from '../../src/commercetools/cart.commercetools';
import { createPayment, updatePayment } from '../../src/commercetools/payment.commercetools';
import { getCustomObjectByKey } from '../../src/commercetools/customObject.commercetools';
import { initEasyCreditClient } from '../../src/client/easycredit.client';
import { ECTransactionCustomerRelationship } from '../../src/types/payment.types';
import { paymentsRoute } from '../../src/routes/payment.route';
import { errorHandler } from '../../src/libs/fastify/error-handler';

// Runs the real service, webshop service, validators and config; only the external APIs are mocked.
jest.mock('../../src/commercetools/cart.commercetools');
jest.mock('../../src/commercetools/payment.commercetools');
jest.mock('../../src/client/easycredit.client');
jest.mock('../../src/commercetools/customObject.commercetools');

const address = { country: 'DE', firstName: 'Max', lastName: 'Mustermann', streetName: 'Hauptstr.', city: 'Berlin' };

const webshopInfo = {
  availability: true,
  installmentPaymentActive: true,
  minInstallmentValue: 200,
  maxInstallmentValue: 10000,
  billPaymentActive: true,
  minBillingValue: 50,
  maxBillingValue: 5000,
};

const mockCart = (amountInEur: number) =>
  ({
    cartState: 'Active',
    billingAddress: address,
    shippingAddress: address,
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

describe('payment type availability', () => {
  let getWebshopInfoMock: jest.Mock<() => Promise<unknown>>;
  let createECPaymentMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    resetWebshopInfoCache();
    getWebshopInfoMock = jest.fn<() => Promise<unknown>>().mockResolvedValue(webshopInfo);
    createECPaymentMock = jest.fn();
    (initEasyCreditClient as jest.Mock).mockReturnValue({
      getWebshopInfo: getWebshopInfoMock,
      createPayment: createECPaymentMock,
    });
  });

  describe('handlePaymentMethod', () => {
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
      ['the webshop endpoint fails', () => getWebshopInfoMock.mockRejectedValue(new Error('Service unavailable'))],
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
      getWebshopInfoMock.mockRejectedValue(new Error('Service unavailable'));
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue(mockCart(500));

      await expect(handlePaymentMethod('cart123')).rejects.toMatchObject({
        code: 'EasyCreditUnavailable',
        fields: { webShopId: '1.de.123123' },
      });
    });
  });

  describe('handleCreatePayment', () => {
    const redirectLinks = {
      urlSuccess: 'https://example.com',
      urlCancellation: 'https://example.com',
      urlDenial: 'https://example.com',
    };

    it('should reject an explicit BILL_PAYMENT over HTTP before touching the cart or creating a payment', async () => {
      // A cart that is valid for both payment types must still not allow bill creation.
      const cart = { ...mockCart(500), lineItems: [] };
      jest.mocked(getCartById).mockResolvedValue(cart);
      jest.mocked(updateCart).mockResolvedValue(cart);
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

      const app = fastify();
      app.setErrorHandler(errorHandler);
      const authHook = { authenticate: () => async () => {} };
      await app.register(paymentsRoute, {
        prefix: '/payments',
        sessionHeaderAuthHook: authHook,
        oauth2AuthHook: authHook,
      } as unknown as Parameters<typeof paymentsRoute>[1]);

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
          expect.objectContaining({ code: 'PaymentTypeNotAvailable', fields: { webShopId: '1.de.123123' } }),
        ]);
        expect(getCartById).not.toHaveBeenCalled();
        expect(updateCart).not.toHaveBeenCalled();
        expect(createPayment).not.toHaveBeenCalled();
        expect(getWebshopInfoMock).not.toHaveBeenCalled();
        expect(createECPaymentMock).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });

    it('should only create installment transactions even if bill payment is available', async () => {
      const cart = mockCart(500);
      // @ts-expect-error mocked
      (getCartById as jest.Mock).mockResolvedValue(cart);
      // @ts-expect-error mocked
      (updateCart as jest.Mock).mockResolvedValue({ ...cart, lineItems: [] });
      // @ts-expect-error mocked
      (createPayment as jest.Mock).mockResolvedValue({ id: 'payment123' });
      // @ts-expect-error mocked
      (updatePayment as jest.Mock).mockResolvedValue({ id: 'payment123' });
      // @ts-expect-error mocked
      (getCustomObjectByKey as jest.Mock).mockResolvedValue({ value: 'https://connector.example.com' });
      // @ts-expect-error mocked
      createECPaymentMock.mockResolvedValue({
        technicalTransactionId: 'tech123',
        transactionId: 'tx123',
        redirectUrl: 'https://easycredit.example.com',
        transactionInformation: { status: 'OPEN', decision: { decisionOutcome: 'POSITIVE', decisionOutcomeText: '' } },
      });

      const result = await handlePaymentMethod('cart123');
      expect(result.paymentTypes.BILL_PAYMENT.available).toBe(true);

      await handleCreatePayment('cart123', redirectLinks, {} as ECTransactionCustomerRelationship);

      expect(createECPaymentMock).toHaveBeenCalledWith(
        expect.objectContaining({ paymentType: 'INSTALLMENT_PAYMENT', paymentSwitchPossible: false }),
      );
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
      expect(createPayment).not.toHaveBeenCalled();
      expect(createECPaymentMock).not.toHaveBeenCalled();
    });
  });
});
