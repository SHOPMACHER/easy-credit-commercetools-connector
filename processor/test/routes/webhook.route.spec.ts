import fastify from 'fastify';
import { webhookRoute } from '../../src/routes/webhook.route';
import { handleAuthorizePayment, handleCancelPayment } from '../../src/services/payment.service';
import {
  AuthorityAuthorizationHook,
  Errorx,
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
  TRANSACTION_IS_AUTHORIZED: 'TransactionIsAuthorized',
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

    const shopCancelUrl = 'https://redirect.com/checkout?step=payment&q=100%25';
    const shopSuccessUrl = 'https://redirect.com/checkout/success?order=1';
    const signedCancelUrl = (paymentId: string, redirectUrl = shopCancelUrl, successUrl = shopSuccessUrl) =>
      `/webhook/${paymentId}/cancel?redirectUrl=${encodeURIComponent(redirectUrl)}&successUrl=${encodeURIComponent(successUrl)}&sig=${signRedirectUrl(paymentId, redirectUrl, successUrl)}`;

    it('should cancel payment and redirect to the shop cancel url', async () => {
      (handleCancelPayment as jest.Mock).mockResolvedValue('12345');

      const response = await app.inject({ method: 'GET', url: signedCancelUrl('12345') });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe(shopCancelUrl);
      expect(handleCancelPayment).toHaveBeenCalledWith('12345');
    });

    it('should redirect to the shop success url when the payment is already authorized', async () => {
      (handleCancelPayment as jest.Mock).mockRejectedValue(
        new Errorx({ code: 'TransactionIsAuthorized', message: 'authorized', httpErrorStatus: 400 }),
      );

      const response = await app.inject({ method: 'GET', url: signedCancelUrl('12345') });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe(shopSuccessUrl);
    });

    it('should redirect to the shop cancel url with an error flag on any other failure', async () => {
      (handleCancelPayment as jest.Mock).mockRejectedValue(new Error('boom'));

      const response = await app.inject({ method: 'GET', url: signedCancelUrl('12345') });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('https://redirect.com/checkout?step=payment&q=100%25&error=cancel_failed');
    });

    it('should reject a success url that was not signed with the cancel url', async () => {
      const response = await app.inject({
        method: 'GET',
        url: signedCancelUrl('12345').replace(
          encodeURIComponent(shopSuccessUrl),
          encodeURIComponent('https://evil.com'),
        ),
      });

      expect(response.statusCode).toBe(400);
      expect(handleCancelPayment).not.toHaveBeenCalled();
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
