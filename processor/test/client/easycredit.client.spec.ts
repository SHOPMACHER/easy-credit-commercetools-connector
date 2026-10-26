/* eslint-disable no-global-assign */
import { initEasyCreditClient } from '../../src/client/easycredit.client';
import { EASYCREDIT_BASE_API_URL, EASYCREDIT_PARTNER_BASE_API_URL } from '../../src/utils/constant.utils';
import { Errorx } from '@commercetools/connect-payments-sdk';
import { ECTransaction } from '../../src/types/payment.types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { log } from '../../src/libs/logger';

// @ts-expect-error: Mock fetch globally
fetch = jest.fn() as jest.Mock;

// Mock the configuration
jest.mock('../../src/utils/config.utils', () => ({
  readConfiguration: jest.fn().mockReturnValue({
    easyCredit: {
      webShopId: 'mock-webshop-id',
      apiPassword: 'mock-api-password',
    },
  }),
}));

describe('initEasyCreditClient', () => {
  let easyCreditClient: ReturnType<typeof initEasyCreditClient>;

  beforeEach(() => {
    easyCreditClient = initEasyCreditClient(); // Initialize the client
    jest.clearAllMocks();
  });

  describe('integrationCheck', () => {
    it('should make a POST request and return the response', async () => {
      const mockResponse = true;
      const payload = { test: 'data' };

      // Mock successful fetch response
      // @ts-expect-error mocked
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        // @ts-expect-error mocked
        json: jest.fn().mockResolvedValueOnce(mockResponse),
      });

      const result = await easyCreditClient.integrationCheck(payload);

      expect(fetch).toHaveBeenCalledWith(`${EASYCREDIT_BASE_API_URL}/payment/v3/webshop/integrationcheck`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${btoa('mock-webshop-id:mock-api-password')}`,
        },
        body: JSON.stringify(payload),
      });

      expect(result).toEqual(mockResponse);
    });
  });

  describe('createPayment', () => {
    const payload: ECTransaction = {
      customer: {
        firstName: '',
        lastName: '',
      },
      redirectLinks: {
        urlSuccess: '',
        urlCancellation: '',
        urlDenial: '',
        urlAuthorizationCallback: '',
      },
      orderDetails: {
        orderValue: 250,
        orderId: 'test',
        numberOfProductsInShoppingCart: 1,
        withoutFlexprice: true,
        invoiceAddress: {
          address: '',
          additionalAddressInformation: '',
          zip: '',
          city: '',
          country: '',
          firstName: '',
          lastName: '',
        },
        shippingAddress: {
          address: '',
          additionalAddressInformation: '',
          zip: '',
          city: '',
          country: '',
          firstName: '',
          lastName: '',
        },
        shoppingCartInformation: [],
      },
    };

    it('should make a POST request and return the payment response', async () => {
      const mockResponse = { paymentStatus: 'SUCCESS' };

      // Mock successful fetch response
      // @ts-expect-error mocked
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        // @ts-expect-error mocked
        json: jest.fn().mockResolvedValueOnce(mockResponse),
      });

      const result = await easyCreditClient.createPayment(payload);

      expect(global.fetch).toHaveBeenCalledWith(`${EASYCREDIT_BASE_API_URL}/payment/v3/transaction`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${btoa('mock-webshop-id:mock-api-password')}`,
        },
        body: JSON.stringify(payload),
      });

      expect(result).toEqual(mockResponse);
    });

    it('should throw Errorx when fetch response is not ok', async () => {
      const mockErrorResponse = {
        title: 'Payment Error',
        violations: [{ field: 'amount', message: 'Invalid amount' }],
      };

      // Mock failed fetch response
      (fetch as jest.Mock).mockImplementation(async () =>
        Promise.resolve({
          ok: false,
          // @ts-expect-error mocked
          json: jest.fn().mockResolvedValueOnce(mockErrorResponse),
        }),
      );

      // Expect Errorx to be thrown
      await expect(easyCreditClient.createPayment(payload)).rejects.toThrowError(Errorx);

      try {
        await easyCreditClient.createPayment(payload);
      } catch (error: any) {
        expect(error).toBeInstanceOf(Errorx);
        expect(error.code).toBe(mockErrorResponse.title);
        expect(error.message).toBe(mockErrorResponse.title);
        expect(error.fields).toEqual(mockErrorResponse.violations);
      }
    });
  });

  describe('authorizePayment', () => {
    it('should make a POST request and return the authorization response', async () => {
      const mockResponse = true;
      const technicalTransactionId = '12345';
      const orderId = '54321';

      // Mock successful fetch response
      // @ts-expect-error mocked
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        // @ts-expect-error mocked
        json: jest.fn().mockResolvedValueOnce(mockResponse),
        status: 202,
      });

      const result = await easyCreditClient.authorizePayment(technicalTransactionId, orderId);

      expect(global.fetch).toHaveBeenCalledWith(
        `${EASYCREDIT_BASE_API_URL}/payment/v3/transaction/${technicalTransactionId}/authorization`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${btoa('mock-webshop-id:mock-api-password')}`,
          },
          body: JSON.stringify({ orderId }),
        },
      );

      expect(result).toEqual(mockResponse);
    });
  });

  describe('authorizePayment errors and signal', () => {
    it('should resolve true only on 202', async () => {
      jest.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 202 }));

      await expect(easyCreditClient.authorizePayment('tech123', 'pay1')).resolves.toBe(true);
    });

    it('should throw an Errorx keeping status and title on a 400', async () => {
      jest.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ title: 'Transaction not authorizable', violations: [{ field: 'a' }] }), {
          status: 400,
        }),
      );

      const promise = easyCreditClient.authorizePayment('tech123', 'pay1');
      await expect(promise).rejects.toBeInstanceOf(Errorx);
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ title: 'Transaction not authorizable' }), { status: 400 }),
        );
      await expect(easyCreditClient.authorizePayment('tech123', 'pay1')).rejects.toMatchObject({
        code: 'Transaction not authorizable',
        message: 'Transaction not authorizable',
        httpErrorStatus: 400,
      });
    });

    it.each([
      ['empty title', { title: '' }],
      ['missing title', {}],
      ['whitespace title', { title: '  ' }],
    ])('should use AuthorizationFailed on a 4xx with %s', async (_name, body) => {
      jest.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 409 }));

      await expect(easyCreditClient.authorizePayment('tech123', 'pay1')).rejects.toMatchObject({
        code: 'AuthorizationFailed',
        message: 'Authorization failed',
        httpErrorStatus: 409,
      });
    });

    it('should use AuthorizationFailed on a non-JSON 4xx body', async () => {
      jest.mocked(fetch).mockResolvedValueOnce(new Response('<html></html>', { status: 403 }));

      await expect(easyCreditClient.authorizePayment('tech123', 'pay1')).rejects.toMatchObject({
        code: 'AuthorizationFailed',
        httpErrorStatus: 403,
      });
    });

    it('should keep the status on a 5xx', async () => {
      jest.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ title: 'Boom' }), { status: 503 }));

      await expect(easyCreditClient.authorizePayment('tech123', 'pay1')).rejects.toMatchObject({
        code: 'Boom',
        httpErrorStatus: 503,
      });
    });

    it.each([200, 204])(
      'should map a %s response to AuthorizationFailed with 502, never a 2xx error',
      async (status) => {
        jest.mocked(fetch).mockResolvedValueOnce(new Response(null, { status }));

        const promise = easyCreditClient.authorizePayment('tech123', 'pay1');
        await expect(promise).rejects.toBeInstanceOf(Errorx);
        await expect(promise).rejects.toMatchObject({ code: 'AuthorizationFailed', httpErrorStatus: 502 });
      },
    );

    it('should map a network error to AuthorizationFailed with 502', async () => {
      jest.mocked(fetch).mockRejectedValueOnce(new TypeError('fetch failed'));

      const promise = easyCreditClient.authorizePayment('tech123', 'pay1');
      await expect(promise).rejects.toBeInstanceOf(Errorx);
      await expect(promise).rejects.toMatchObject({ code: 'AuthorizationFailed', httpErrorStatus: 502 });
    });

    it.each(['AbortError', 'TimeoutError'])('should map a %s to AuthorizationFailed with 504', async (name) => {
      jest.mocked(fetch).mockRejectedValueOnce(new DOMException('aborted', name));

      await expect(easyCreditClient.authorizePayment('tech123', 'pay1')).rejects.toMatchObject({
        code: 'AuthorizationFailed',
        httpErrorStatus: 504,
      });
    });

    it('should forward the signal to fetch', async () => {
      const signal = new AbortController().signal;
      jest.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 202 }));

      await easyCreditClient.authorizePayment('tech123', 'pay1', signal);

      expect(fetch).toHaveBeenCalledWith(
        `${EASYCREDIT_BASE_API_URL}/payment/v3/transaction/tech123/authorization`,
        expect.objectContaining({ signal }),
      );
    });
  });

  describe('getPayment signal', () => {
    it('should forward the signal to fetch', async () => {
      const signal = new AbortController().signal;
      jest.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

      await easyCreditClient.getPayment('tech123', signal);

      expect(fetch).toHaveBeenCalledWith(
        `${EASYCREDIT_BASE_API_URL}/payment/v3/transaction/tech123`,
        expect.objectContaining({ method: 'GET', signal }),
      );
    });
  });

  describe('getPayment', () => {
    it('should make a GET request and return the payment response', async () => {
      const mockResponse = { paymentStatus: 'SUCCESS' };
      const technicalTransactionId = '12345';

      // Mock successful fetch response
      (fetch as jest.Mock).mockImplementation(async () =>
        Promise.resolve({
          ok: true,
          // @ts-expect-error mocked
          json: jest.fn().mockResolvedValueOnce(mockResponse),
        }),
      );

      const result = await easyCreditClient.getPayment(technicalTransactionId);

      expect(global.fetch).toHaveBeenCalledWith(
        `${EASYCREDIT_BASE_API_URL}/payment/v3/transaction/${technicalTransactionId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${btoa('mock-webshop-id:mock-api-password')}`,
          },
        },
      );

      expect(result).toEqual(mockResponse);
    });

    it('should throw Errorx when fetch response is not ok', async () => {
      const mockErrorResponse = {
        title: 'Transaction Error',
        violations: [{ field: 'transaction', message: 'Invalid transaction' }],
      };
      const technicalTransactionId = '12345';

      // Mock failed fetch response
      (fetch as jest.Mock).mockImplementation(async () =>
        Promise.resolve({
          ok: false,
          // @ts-expect-error mocked
          json: jest.fn().mockResolvedValueOnce(mockErrorResponse),
        }),
      );

      // Expect Errorx to be thrown
      await expect(easyCreditClient.getPayment(technicalTransactionId)).rejects.toThrowError(Errorx);

      try {
        await easyCreditClient.getPayment(technicalTransactionId);
      } catch (error: any) {
        expect(error).toBeInstanceOf(Errorx);
        expect(error.code).toBe(mockErrorResponse.title);
        expect(error.message).toBe(mockErrorResponse.title);
        expect(error.fields).toEqual(mockErrorResponse.violations);
      }
    });
  });

  describe.each([
    {
      name: 'capturePayment',
      call: (client: ReturnType<typeof initEasyCreditClient>) => client.capturePayment('TX1234', 'pay1', 'track1'),
      url: `${EASYCREDIT_PARTNER_BASE_API_URL}/merchant/v3/transaction/TX1234/capture`,
      body: { orderId: 'pay1', trackingNumber: 'track1' },
      code: 'CaptureFailed',
      message: 'Capture failed',
    },
    {
      name: 'refundPayment',
      call: (client: ReturnType<typeof initEasyCreditClient>) =>
        client.refundPayment('TX1234', { value: 100, bookingId: '123-abc' }),
      url: `${EASYCREDIT_PARTNER_BASE_API_URL}/merchant/v3/transaction/TX1234/refund`,
      body: { value: 100, bookingId: '123-abc' },
      code: 'RefundFailed',
      message: 'Refund failed',
    },
  ])('$name', ({ call, url, body, code, message }) => {
    it('should POST to the merchant API and resolve on 202', async () => {
      jest.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 202 }));

      await expect(call(easyCreditClient)).resolves.toBeUndefined();
      expect(fetch).toHaveBeenCalledWith(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${btoa('mock-webshop-id:mock-api-password')}`,
        },
        body: JSON.stringify(body),
      });
    });

    it('should throw an Errorx keeping the easyCredit status, title and violations', async () => {
      const violations = [{ field: 'value', message: 'too high' }];
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ title: 'Booking not allowed', violations }), { status: 409 }),
        );

      const promise = call(easyCreditClient);
      await expect(promise).rejects.toBeInstanceOf(Errorx);
      await expect(promise).rejects.toMatchObject({
        code: 'Booking not allowed',
        message: 'Booking not allowed',
        httpErrorStatus: 409,
        fields: violations,
      });
    });

    it('should fall back to its own code on a non-JSON error body', async () => {
      jest.mocked(fetch).mockResolvedValueOnce(new Response('<html></html>', { status: 503 }));

      await expect(call(easyCreditClient)).rejects.toMatchObject({ code, message, httpErrorStatus: 503 });
    });

    it.each([200, 204])('should map a %s response to a 502, never a 2xx error', async (status) => {
      jest.mocked(fetch).mockResolvedValueOnce(new Response(null, { status }));

      await expect(call(easyCreditClient)).rejects.toMatchObject({ code, httpErrorStatus: 502 });
    });

    it('should map a network error to a 502', async () => {
      jest.mocked(fetch).mockRejectedValueOnce(new TypeError('fetch failed'));

      await expect(call(easyCreditClient)).rejects.toMatchObject({ code, message, httpErrorStatus: 502 });
      expect(log.error).toHaveBeenCalledTimes(1);
    });

    it('should map a timeout to a 504', async () => {
      jest.mocked(fetch).mockRejectedValueOnce(new DOMException('aborted', 'TimeoutError'));

      await expect(call(easyCreditClient)).rejects.toMatchObject({ code, httpErrorStatus: 504 });
    });
  });

  describe('getWebshopInfo', () => {
    it('should fetch the webshop info with a timeout', async () => {
      const mockResponse = { billPaymentActive: true, minBillingValue: 50, maxBillingValue: 5000 };
      const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');

      // @ts-expect-error mocked
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        // @ts-expect-error mocked
        json: jest.fn().mockResolvedValueOnce(mockResponse),
      });

      const result = await easyCreditClient.getWebshopInfo();

      expect(fetch).toHaveBeenCalledWith(`${EASYCREDIT_BASE_API_URL}/payment/v3/webshop/mock-webshop-id`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${btoa('mock-webshop-id:mock-api-password')}`,
        },
        signal: expect.any(AbortSignal),
      });
      expect(timeoutSpy).toHaveBeenCalledWith(10000);
      expect(result).toEqual(mockResponse);
    });

    it('should throw an Errorx if the response is not ok', async () => {
      // @ts-expect-error mocked
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        // @ts-expect-error mocked
        json: jest.fn().mockResolvedValueOnce({ title: 'Not Found' }),
      });

      await expect(easyCreditClient.getWebshopInfo()).rejects.toThrow(Errorx);
    });

    it('should keep the status code if the error body is not JSON', async () => {
      // @ts-expect-error mocked
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        // @ts-expect-error mocked
        json: jest.fn().mockRejectedValueOnce(new SyntaxError('Unexpected token <')),
      });

      await expect(easyCreditClient.getWebshopInfo()).rejects.toMatchObject({
        code: 'Unknown Error',
        httpErrorStatus: 401,
      });
    });

    it.each([401, 403, 404])('should keep status %s if the error body is null', async (status) => {
      jest.mocked(fetch).mockResolvedValueOnce(new Response('null', { status }));

      await expect(easyCreditClient.getWebshopInfo()).rejects.toMatchObject({
        code: 'Unknown Error',
        httpErrorStatus: status,
      });
    });

    it.each([401, false, { message: 'Unauthorized' }, ['Unauthorized']])(
      'should keep an authentication error status when its title is %j',
      async (title) => {
        jest.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ title }), { status: 401 }));

        await expect(easyCreditClient.getWebshopInfo()).rejects.toMatchObject({
          code: 'Unknown Error',
          message: 'An error occurred',
          httpErrorStatus: 401,
        });
      },
    );
  });

  describe('error responses of other endpoints', () => {
    it('should keep the upstream status of a non-JSON health check error', async () => {
      jest.mocked(fetch).mockResolvedValueOnce(new Response('<html>Bad Gateway</html>', { status: 502 }));

      await expect(easyCreditClient.integrationCheck({ message: 'test' })).rejects.toMatchObject({
        code: 'Unknown Error',
        message: 'An error occurred',
        httpErrorStatus: 502,
      });
    });

    it.each(['', '   '])('should fall back to a generic code if the error title is %j', async (title) => {
      jest.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ title }), { status: 400 }));

      await expect(easyCreditClient.getPayment('tech123')).rejects.toMatchObject({
        code: 'Unknown Error',
        message: 'An error occurred',
        httpErrorStatus: 400,
      });
    });
  });

  describe('getMerchantTransaction', () => {
    it('should make a GET request and return the transaction details response', async () => {
      const transactionId = '12345';
      const mockResponse = { transactionId };

      // Mock successful fetch response
      (fetch as jest.Mock).mockImplementation(async () =>
        Promise.resolve({
          ok: true,
          // @ts-expect-error mocked
          json: jest.fn().mockResolvedValueOnce(mockResponse),
        }),
      );

      const result = await easyCreditClient.getMerchantTransaction(transactionId);

      expect(global.fetch).toHaveBeenCalledWith(
        `${EASYCREDIT_PARTNER_BASE_API_URL}/merchant/v3/transaction/${transactionId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${btoa('mock-webshop-id:mock-api-password')}`,
          },
        },
      );

      expect(result).toEqual(mockResponse);
    });

    it('should throw Errorx when fetch response is not ok', async () => {
      const mockErrorResponse = {
        title: 'Transaction Error',
        violations: [{ field: 'transaction', message: 'Invalid transaction' }],
      };
      const transactionId = '12345';

      // Mock failed fetch response
      (fetch as jest.Mock).mockImplementation(async () =>
        Promise.resolve({
          ok: false,
          // @ts-expect-error mocked
          json: jest.fn().mockResolvedValueOnce(mockErrorResponse),
        }),
      );

      // Expect Errorx to be thrown
      await expect(easyCreditClient.getMerchantTransaction(transactionId)).rejects.toThrowError(Errorx);

      try {
        await easyCreditClient.getMerchantTransaction(transactionId);
      } catch (error: any) {
        expect(error).toBeInstanceOf(Errorx);
        expect(error.code).toBe(mockErrorResponse.title);
        expect(error.message).toBe(mockErrorResponse.title);
        expect(error.fields).toEqual(mockErrorResponse.violations);
      }
    });
  });
});
