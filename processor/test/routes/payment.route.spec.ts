import fastify from 'fastify';
import { paymentsRoute } from '../../src/routes/payment.route';
import {
  handleAuthorizeECPayment,
  handleCreatePayment,
  handlePaymentMethod,
  handleGetPayment,
  handleCapturePayment,
  handleRefundPayment,
} from '../../src/services/payment.service';
import {
  AuthorityAuthorizationHook,
  JWTAuthenticationHook,
  Oauth2AuthenticationHook,
  Payment,
  SessionHeaderAuthenticationHook,
} from '@commercetools/connect-payments-sdk';
import { IncomingHttpHeaders } from 'node:http';
import { describe, jest, it, expect, afterEach, beforeAll, afterAll } from '@jest/globals';

// Mocks for imported service functions
jest.mock('../../src/services/payment.service', () => ({
  handleAuthorizeECPayment: jest.fn(),
  handleCreatePayment: jest.fn(),
  handlePaymentMethod: jest.fn(),
  handleGetPayment: jest.fn(),
  handleCapturePayment: jest.fn(),
  handleRefundPayment: jest.fn(),
}));

describe('paymentsRoute', () => {
  const app = fastify({ logger: false });
  const token = 'token';
  const sessionId = 'session-id';

  beforeAll(async () => {
    await app.register(paymentsRoute, {
      prefix: '/payments',
      oauth2AuthHook: {
        authenticate: jest.fn(() => async (request: { headers: IncomingHttpHeaders }) => {
          expect(request.headers['authorization']).toContain(`Bearer ${token}`);
        }),
      } as unknown as Oauth2AuthenticationHook,
      jwtAuthHook: jest.fn() as unknown as JWTAuthenticationHook,
      sessionHeaderAuthHook: {
        authenticate: jest.fn(() => async (request: { headers: IncomingHttpHeaders }) => {
          expect(request.headers['x-session-id']).toContain(sessionId);
        }),
      } as unknown as SessionHeaderAuthenticationHook,
      authorizationHook: jest.fn() as unknown as AuthorityAuthorizationHook,
    });
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /payments/payment-method/:cartId', () => {
    it('should return payment method config', async () => {
      const cartId = '12345';
      const mockResponse = { webShopId: 'mock-webshop-id', amount: 100 };
      // @ts-expect-error mocked
      (handlePaymentMethod as jest.Mock).mockResolvedValue(mockResponse);

      const response = await app.inject({
        method: 'GET',
        url: `/payments/payment-method/${cartId}`,
        headers: {
          'x-session-id': sessionId,
          'content-type': 'application/json',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockResponse);
      expect(handlePaymentMethod).toHaveBeenCalledWith(cartId);
    });
  });

  describe('POST /payments', () => {
    it('should create payment', async () => {
      const mockRequest = {
        cartId: '12345',
        redirectLinks: {
          urlSuccess: 'https://urlSuccess.com',
          urlCancellation: 'https://urlCancellation.com',
          urlDenial: 'https://urlDenial.com',
        },
        customerRelationship: {
          customerStatus: 'NEW_CUSTOMER',
          customerSince: '2024-01-01',
          numberOfOrders: 0,
        },
      };
      const mockResponse = {
        technicalTransactionId: 'technicalTransactionId',
        paymentId: 'paymentId',
        redirectUrl: 'redirectUrl',
        transactionInformation: {
          status: 'status',
          decision: {
            decisionOutcome: 'decisionOutcome',
            decisionOutcomeText: null,
          },
        },
      };
      // @ts-expect-error mocked
      (handleCreatePayment as jest.Mock).mockResolvedValue(mockResponse);

      const response = await app.inject({
        method: 'POST',
        url: `/payments`,
        body: mockRequest,
        headers: {
          'x-session-id': sessionId,
          'content-type': 'application/json',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual(mockResponse);
      expect(handleCreatePayment).toHaveBeenCalledWith(
        mockRequest.cartId,
        mockRequest.redirectLinks,
        mockRequest.customerRelationship,
      );
    });
  });

  describe('GET /payments/paymentId', () => {
    it('should retrieve payment', async () => {
      const paymentId = 'payment123';
      const mockResponse = {
        webShopId: 'webShopId',
        amount: 100,
        status: 'status',
        decision: {
          interest: 10,
          totalValue: 10,
          orderValue: 10,
          decisionOutcome: 'decisionOutcome',
          numberOfInstallments: 10,
          installment: 10,
          lastInstallment: 10,
          mtan: {
            required: true,
            successful: true,
          },
          bankAccountCheck: {
            required: true,
          },
        },
      };
      // @ts-expect-error mocked
      (handleGetPayment as jest.Mock).mockResolvedValue(mockResponse);

      const response = await app.inject({
        method: 'GET',
        url: `/payments/${paymentId}`,
        headers: {
          'x-session-id': sessionId,
          'content-type': 'application/json',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockResponse);
      expect(handleGetPayment).toHaveBeenCalledWith(paymentId);
    });
  });

  describe('POST /payments/:paymentId/authorize', () => {
    it('should authorize payment', async () => {
      const paymentId = 'payment123';
      // @ts-expect-error mocked
      (handleAuthorizeECPayment as jest.Mock).mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: `/payments/${paymentId}/authorize`,
        body: {},
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe('');
      expect(handleAuthorizeECPayment).toHaveBeenCalledWith(paymentId);
    });
  });

  describe('POST /payments/:paymentId/capture', () => {
    it('should capture payment', async () => {
      const paymentId = 'payment123';
      const mockRequest = { trackingNumber: 'track123' };
      // @ts-expect-error mocked
      (handleCapturePayment as jest.Mock).mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: `/payments/${paymentId}/capture`,
        payload: mockRequest,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe('');
      expect(handleCapturePayment).toHaveBeenCalledWith(paymentId, mockRequest.trackingNumber);
    });
  });

  describe('POST /payments/:paymentId/refund', () => {
    it('should refund payment', async () => {
      const paymentId = 'payment123';
      const mockRequest = { amount: 2 };

      const mockPayment = {
        id: 'test',
      } as Payment;
      // @ts-expect-error mocked
      (handleRefundPayment as jest.Mock).mockResolvedValue(mockPayment);

      const response = await app.inject({
        method: 'POST',
        url: `/payments/${paymentId}/refund`,
        payload: mockRequest,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toStrictEqual(mockPayment);
      expect(handleRefundPayment).toHaveBeenCalledWith(paymentId, mockRequest.amount);
    });
  });
});
