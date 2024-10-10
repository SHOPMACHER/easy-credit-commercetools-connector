import { FastifyInstance } from 'fastify';
import { paymentSDK } from '../../payment-sdk';
import { operationsRoute } from '../../routes/operation.route';

export default async function (server: FastifyInstance) {
  await server.register(operationsRoute, {
    prefix: '/operations',
    jwtAuthHook: paymentSDK.jwtAuthHookFn,
    oauth2AuthHook: paymentSDK.oauth2AuthHookFn,
    sessionHeaderAuthHook: paymentSDK.sessionHeaderAuthHookFn,
    authorizationHook: paymentSDK.authorityAuthorizationHookFn,
  });
}
