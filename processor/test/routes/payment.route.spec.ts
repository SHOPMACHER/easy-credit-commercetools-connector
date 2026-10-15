import fastify, { RouteOptions } from 'fastify';
import { paymentsRoute } from '../../src/routes/payment.route';
import {
  handleAuthorizeECPayment,
  handleCapturePayment,
  handleCreatePayment,
  handleGetPayment,
  handlePaymentMethod,
  handleRefundPayment,
} from '../../src/services/payment.service';
import {
  AuthorityAuthorizationHook,
  Errorx,
  JWTAuthenticationHook,
  Oauth2AuthenticationHook,
  Payment,
  SessionHeaderAuthenticationHook,
} from '@commercetools/connect-payments-sdk';
import { IncomingHttpHeaders } from 'node:http';
import { errorHandler } from '../../src/libs/fastify/error-handler';
import { GetPaymentMethodParamsSchema } from '../../src/dtos/payments/getPaymentMethod.dto';
import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';

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
  const routeOptions: RouteOptions[] = [];

  beforeAll(async () => {
    app.addHook('onRoute', (route) => {
      routeOptions.push(route);
    });
    app.setErrorHandler(errorHandler);
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
    it('should declare the cartId path param in the schema', () => {
      expect(GetPaymentMethodParamsSchema.properties).toEqual({ cartId: expect.objectContaining({ type: 'string' }) });
    });

    it('should return payment method config', async () => {
      const cartId = '12345';
      const mockResponse = {
        webShopId: 'mock-webshop-id',
        amount: 100,
        paymentTypes: {
          INSTALLMENT_PAYMENT: { available: false, minAmount: 200, maxAmount: 10000 },
          BILL_PAYMENT: { available: true, minAmount: 50, maxAmount: 5000 },
        },
      };
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
      expect(handlePaymentMethod).toHaveBeenCalledWith(cartId, undefined);
    });

    it('should pass the requested payment type to the handler', async () => {
      // @ts-expect-error mocked
      (handlePaymentMethod as jest.Mock).mockResolvedValue({
        webShopId: 'mock-webshop-id',
        amount: 100,
        paymentTypes: {
          INSTALLMENT_PAYMENT: { available: false },
          BILL_PAYMENT: { available: true },
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/payments/payment-method/12345?paymentType=BILL_PAYMENT',
        headers: { 'x-session-id': sessionId },
      });

      expect(response.statusCode).toBe(200);
      expect(handlePaymentMethod).toHaveBeenCalledWith('12345', 'BILL_PAYMENT');
    });

    it('should reject an unknown payment type', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/payments/payment-method/12345?paymentType=UNKNOWN',
        headers: { 'x-session-id': sessionId },
      });

      expect(response.statusCode).toBe(400);
      expect(handlePaymentMethod).not.toHaveBeenCalled();
    });

    it('should not expose the internal enabled flag', async () => {
      // @ts-expect-error mocked
      (handlePaymentMethod as jest.Mock).mockResolvedValue({
        webShopId: 'mock-webshop-id',
        amount: 100,
        paymentTypes: {
          INSTALLMENT_PAYMENT: { enabled: true, available: false, minAmount: 200, maxAmount: 10000 },
          BILL_PAYMENT: { enabled: true, available: true, minAmount: 50, maxAmount: 5000 },
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/payments/payment-method/12345',
        headers: {
          'x-session-id': sessionId,
          'content-type': 'application/json',
        },
      });

      expect(response.json().paymentTypes).toEqual({
        INSTALLMENT_PAYMENT: { available: false, minAmount: 200, maxAmount: 10000 },
        BILL_PAYMENT: { available: true, minAmount: 50, maxAmount: 5000 },
      });
    });
  });

  describe('POST /payments', () => {
    it.each([undefined, 'INSTALLMENT_PAYMENT'])('should create payment with paymentType=%s', async (paymentType) => {
      const mockRequest = {
        cartId: '12345',
        paymentType,
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
        paymentType,
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

    const getPayment = (paymentId: string) =>
      app.inject({
        method: 'GET',
        url: `/payments/${paymentId}`,
        headers: { 'x-session-id': sessionId, 'content-type': 'application/json' },
      });

    it('should serialize an installment decision with paymentType', async () => {
      const mockResponse = {
        webShopId: 'webShopId',
        amount: 100,
        status: 'status',
        paymentType: 'INSTALLMENT_PAYMENT',
        decision: {
          interest: 10,
          totalValue: 110,
          orderValue: 100,
          decisionOutcome: 'POSITIVE',
          numberOfInstallments: 10,
          installment: 11,
          lastInstallment: 11,
          mtan: { required: true, successful: false },
          bankAccountCheck: { required: true },
        },
      };
      // @ts-expect-error mocked
      (handleGetPayment as jest.Mock).mockResolvedValue(mockResponse);

      const response = await getPayment('payment123');

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockResponse);
    });

    it('should serialize a bill decision without installment fields', async () => {
      const mockResponse = {
        webShopId: 'webShopId',
        amount: 100,
        status: 'status',
        paymentType: 'BILL_PAYMENT',
        decision: {
          transactionId: 'ec-tx-1',
          orderValue: 100,
          decisionOutcome: 'POSITIVE',
        },
      };
      // @ts-expect-error mocked
      (handleGetPayment as jest.Mock).mockResolvedValue(mockResponse);

      const response = await getPayment('payment123');

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        webShopId: 'webShopId',
        amount: 100,
        status: 'status',
        paymentType: 'BILL_PAYMENT',
        decision: { orderValue: 100, decisionOutcome: 'POSITIVE' },
      });
    });

    it('should serialize a bill decision when paymentType is omitted', async () => {
      const mockResponse = {
        webShopId: 'webShopId',
        amount: 100,
        status: 'status',
        decision: { orderValue: 100, decisionOutcome: 'POSITIVE' },
      };
      // @ts-expect-error mocked
      (handleGetPayment as jest.Mock).mockResolvedValue(mockResponse);

      const response = await getPayment('payment123');

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockResponse);
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

    it('should declare a 504 response schema on the authorize route', () => {
      const route = routeOptions.find((r) => r.url === '/payments/:paymentId/authorize' && r.method === 'POST');

      expect((route?.schema?.response as Record<number, unknown> | undefined)?.[504]).toBeDefined();
    });

    it('should answer 504 with the error body when the authorization times out', async () => {
      (handleAuthorizeECPayment as jest.Mock).mockRejectedValue(
        new Errorx({ code: 'AuthorizationTimeout', message: 'Timeout', httpErrorStatus: 504 }) as never,
      );

      const response = await app.inject({
        method: 'POST',
        url: '/payments/payment123/authorize',
        body: {},
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
      });

      expect(response.statusCode).toBe(504);
      expect(response.json()).toEqual({
        message: 'Timeout',
        statusCode: 504,
        errors: [{ code: 'AuthorizationTimeout', message: 'Timeout' }],
      });
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
