import { FastifyInstance } from 'fastify';
import { paymentSDK } from '../../payment-sdk';
import { paymentsRoute } from '../../routes/payment.route';

export default async function (server: FastifyInstance) {
  await server.register(paymentsRoute, {
    prefix: '/payments',
    jwtAuthHook: paymentSDK.jwtAuthHookFn,
    oauth2AuthHook: paymentSDK.oauth2AuthHookFn,
    sessionHeaderAuthHook: paymentSDK.sessionHeaderAuthHookFn,
    authorizationHook: paymentSDK.authorityAuthorizationHookFn,
  });
}
