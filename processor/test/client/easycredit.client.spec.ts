import { initEasyCreditClient } from '../../src/client/easycredit.client';
import { EASYCREDIT_BASE_API_URL, EASYCREDIT_PARTNER_BASE_API_URL } from '../../src/utils/constant.utils';
import { Errorx } from '@commercetools/connect-payments-sdk';
import { ECTransaction } from '../../src/types/payment.types';
import { describe, jest, it, expect, beforeEach } from '@jest/globals';
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        expect(error).toBeInstanceOf(Errorx);
        expect(error.code).toBe(mockErrorResponse.title);
        expect(error.message).toBe(mockErrorResponse.title);
        expect(error.fields).toEqual(mockErrorResponse.violations);
      }
    });
  });

  describe('refundPayment', () => {
    it('should make a POST request and return true when status code is 202', async () => {
      const ecTransactionId = '12345';
      const payload = {
        value: 100,
        bookingId: '123-abc',
      };

      // Mock successful fetch response
      (fetch as jest.Mock).mockImplementation(async () =>
        Promise.resolve({
          status: 202,
        }),
      );

      const result = await easyCreditClient.refundPayment(ecTransactionId, payload);

      expect(global.fetch).toHaveBeenCalledWith(
        `${EASYCREDIT_PARTNER_BASE_API_URL}/merchant/v3/transaction/${ecTransactionId}/refund`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${btoa('mock-webshop-id:mock-api-password')}`,
          },
          body: JSON.stringify(payload),
        },
      );

      expect(result).toEqual(true);
    });

    it('should return false when the status code is not 202', async () => {
      const ecTransactionId = '12345';
      const payload = {
        value: 100,
        bookingId: '123-abc',
      };

      const mockedFetchResult = new Error('Refund request returned invalid status code');

      // Mock successful fetch response
      (fetch as jest.Mock).mockImplementation(async () => Promise.resolve(mockedFetchResult));

      const result = await easyCreditClient.refundPayment(ecTransactionId, payload);

      expect(global.fetch).toHaveBeenCalledWith(
        `${EASYCREDIT_PARTNER_BASE_API_URL}/merchant/v3/transaction/${ecTransactionId}/refund`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${btoa('mock-webshop-id:mock-api-password')}`,
          },
          body: JSON.stringify(payload),
        },
      );

      expect(log.error).toBeCalledTimes(1);
      expect(log.error).toBeCalledWith('Failed to create refund', mockedFetchResult);
      expect(result).toBe(false);
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        expect(error).toBeInstanceOf(Errorx);
        expect(error.code).toBe(mockErrorResponse.title);
        expect(error.message).toBe(mockErrorResponse.title);
        expect(error.fields).toEqual(mockErrorResponse.violations);
      }
    });
  });
});
