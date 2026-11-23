import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import Fastify from 'fastify';
import { paymentSDK } from '../../src/payment-sdk';
import { paymentsRoute } from '../../src/routes/payment.route';
import { requestContextPlugin } from '../../src/libs/fastify/context/context';
import { errorHandler } from '../../src/libs/fastify/error-handler';
import { handleCapturePayment, handleRefundPayment } from '../../src/services/payment.service';

jest.mock('../../src/services/payment.service');

// The real SDK hooks: only the commercetools token introspection behind fetch is faked.
let grantedScope: string;
const introspect = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
  if (!String(input).endsWith('/oauth/introspect')) {
    throw new Error(`Unexpected request ${String(input)}`);
  }
  return new Response(JSON.stringify({ active: true, scope: grantedScope, client_id: 'client-1' }), { status: 200 });
});

describe('scope check on capture and refund with the SDK hooks', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.setErrorHandler(errorHandler);
    await app.register(requestContextPlugin);
    await app.register(paymentsRoute, {
      prefix: '/payments',
      jwtAuthHook: paymentSDK.jwtAuthHookFn,
      oauth2AuthHook: paymentSDK.oauth2AuthHookFn,
      sessionHeaderAuthHook: paymentSDK.sessionHeaderAuthHookFn,
      authorizationHook: paymentSDK.authorityAuthorizationHookFn,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    introspect.mockRestore();
  });

  beforeEach(() => {
    jest.mocked(handleCapturePayment).mockClear();
    jest.mocked(handleRefundPayment).mockClear();
    jest.mocked(handleCapturePayment).mockResolvedValue(undefined);
    jest.mocked(handleRefundPayment).mockResolvedValue({ id: 'payment123' } as never);
  });

  const send = (path: string, payload: object) =>
    app.inject({
      method: 'POST',
      url: `/payments/payment123/${path}`,
      payload,
      headers: { authorization: 'Bearer token-1', 'content-type': 'application/json' },
    });

  describe.each([
    ['capture', { trackingNumber: 'track-1' }, handleCapturePayment, 204],
    ['refund', { amount: 2 }, handleRefundPayment, 202],
  ])('%s', (path, payload, handler, status) => {
    it.each(['manage_payments', 'manage_checkout_payment_intents', 'manage_project'])(
      'is allowed with %s',
      async (scope) => {
        grantedScope = `view_orders:project-1 ${scope}:project-1`;

        const response = await send(path, payload);

        expect(response.statusCode).toBe(status);
        expect(handler).toHaveBeenCalledTimes(1);
      },
    );

    it('answers 401 with the accepted scopes without calling the handler for a token without them', async () => {
      grantedScope = 'view_orders:project-1 manage_sessions:project-1';

      const response = await send(path, payload);

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        errors: [
          expect.objectContaining({
            code: 'invalid_token',
            fields: { validAuthorities: ['manage_payments', 'manage_checkout_payment_intents', 'manage_project'] },
          }),
        ],
      });
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
