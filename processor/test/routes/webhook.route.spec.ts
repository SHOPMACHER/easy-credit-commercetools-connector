import fastify from 'fastify';
import { webhookRoute } from '../../src/routes/webhook.route';
import { handleAuthorizePayment, handleCancelPayment } from '../../src/services/payment.service';
import {
  AuthorityAuthorizationHook,
  JWTAuthenticationHook,
  Oauth2AuthenticationHook,
  SessionHeaderAuthenticationHook,
} from '@commercetools/connect-payments-sdk';

// Mocks for imported service functions
jest.mock('../../src/services/payment.service', () => ({
  handleAuthorizePayment: jest.fn(),
  handleCancelPayment: jest.fn(),
}));

describe('webhookRoute', () => {
  const app = fastify({ logger: false });

  beforeAll(async () => {
    await app.register(webhookRoute, {
      prefix: '/webhook',
      oauth2AuthHook: jest.fn() as unknown as Oauth2AuthenticationHook,
      jwtAuthHook: jest.fn() as unknown as JWTAuthenticationHook,
      sessionHeaderAuthHook: jest.fn() as unknown as SessionHeaderAuthenticationHook,
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

  describe('GET /webhook/:paymentId/cancel', () => {
    it('should cancel payment and return payment id', async () => {
      const paymentId = '12345';
      (handleCancelPayment as jest.Mock).mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: `/webhook/${paymentId}/cancel`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ paymentId });
      expect(handleCancelPayment).toHaveBeenCalledWith(paymentId);
    });

    it('should cancel payment and redirect', async () => {
      const paymentId = '12345';
      const redirectUrl = 'https://redirect.com';
      (handleCancelPayment as jest.Mock).mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: `/webhook/${paymentId}/cancel?redirectUrl=${redirectUrl}`,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe(redirectUrl);
      expect(handleCancelPayment).toHaveBeenCalledWith(paymentId);
    });
  });

  describe('GET /webhook/:paymentId/authorize', () => {
    it('should authorize payment and return payment id', async () => {
      const paymentId = '12345';
      (handleAuthorizePayment as jest.Mock).mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: `/webhook/${paymentId}/authorize`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ paymentId });
      expect(handleAuthorizePayment).toHaveBeenCalledWith(paymentId);
    });

    it('should authorize payment and redirect', async () => {
      const paymentId = '12345';
      const redirectUrl = 'https://redirect.com';
      (handleAuthorizePayment as jest.Mock).mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: `/webhook/${paymentId}/authorize?redirectUrl=${redirectUrl}`,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe(redirectUrl);
      expect(handleAuthorizePayment).toHaveBeenCalledWith(paymentId);
    });
  });
});
