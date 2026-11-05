import fastify from 'fastify';
import { webhookRoute } from '../../src/routes/webhook.route';
import { handleAuthorizePayment, handleCancelPayment } from '../../src/services/payment.service';
import {
  AuthorityAuthorizationHook,
  JWTAuthenticationHook,
  Oauth2AuthenticationHook,
  SessionHeaderAuthenticationHook,
} from '@commercetools/connect-payments-sdk';
import { signRedirectUrl } from '../../src/utils/redirect.utils';
import { errorHandler } from '../../src/libs/fastify/error-handler';

// Mocks for imported service functions
jest.mock('../../src/services/payment.service', () => ({
  handleAuthorizePayment: jest.fn(),
  handleCancelPayment: jest.fn(),
}));

jest.mock('../../src/libs/logger');

describe('webhookRoute', () => {
  const app = fastify({ logger: false });

  beforeAll(async () => {
    app.setErrorHandler(errorHandler);
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

    it('should cancel payment and redirect when the redirect url is signed', async () => {
      const paymentId = '12345';
      const redirectUrl = 'https://redirect.com/checkout?step=payment&q=100%25';
      (handleCancelPayment as jest.Mock).mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: `/webhook/${paymentId}/cancel?redirectUrl=${encodeURIComponent(redirectUrl)}&sig=${signRedirectUrl(paymentId, redirectUrl)}`,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe(redirectUrl);
      expect(handleCancelPayment).toHaveBeenCalledWith(paymentId);
    });

    it('should still redirect back to the shop when the cancel fails', async () => {
      const paymentId = '12345';
      const redirectUrl = 'https://redirect.com/checkout';
      (handleCancelPayment as jest.Mock).mockRejectedValue(new Error('TransactionIsAuthorized'));

      const response = await app.inject({
        method: 'GET',
        url: `/webhook/${paymentId}/cancel?redirectUrl=${encodeURIComponent(redirectUrl)}&sig=${signRedirectUrl(paymentId, redirectUrl)}`,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe(redirectUrl);
    });

    it('should return the error when there is no redirect url', async () => {
      (handleCancelPayment as jest.Mock).mockRejectedValue(new Error('boom'));

      const response = await app.inject({ method: 'GET', url: '/webhook/12345/cancel' });

      expect(response.statusCode).toBe(500);
    });

    it.each([
      ['missing', ''],
      ['invalid', '&sig=deadbeef'],
      ['signed for another payment', `&sig=${signRedirectUrl('other', 'https://evil.com')}`],
    ])('should reject a redirect url with a %s signature', async (_, sigParam) => {
      const response = await app.inject({
        method: 'GET',
        url: `/webhook/12345/cancel?redirectUrl=${encodeURIComponent('https://evil.com')}${sigParam}`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.headers.location).toBeUndefined();
      expect(handleCancelPayment).not.toHaveBeenCalled();
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
  });
});
