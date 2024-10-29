import { initEasyCreditClient } from '../../src/client/easycredit.client';
import { EASYCREDIT_BASE_API_URL } from '../../src/utils/constant.utils';
import { Errorx } from '@commercetools/connect-payments-sdk';
import { ECTransaction } from '../../src/types/payment.types';

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
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
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
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
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
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
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
});
