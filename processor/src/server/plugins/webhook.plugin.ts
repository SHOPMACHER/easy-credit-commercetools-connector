import { FastifyInstance } from 'fastify';
import { paymentSDK } from '../../payment-sdk';
import { webhookRoute } from '../../routes/webhook.route';

export default async function (server: FastifyInstance) {
  await server.register(webhookRoute, {
    prefix: '/webhook',
    jwtAuthHook: paymentSDK.jwtAuthHookFn,
    oauth2AuthHook: paymentSDK.oauth2AuthHookFn,
    sessionHeaderAuthHook: paymentSDK.sessionHeaderAuthHookFn,
    authorizationHook: paymentSDK.authorityAuthorizationHookFn,
  });
}
