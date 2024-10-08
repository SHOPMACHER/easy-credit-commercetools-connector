import { ErrorResponse } from './../libs/fastify/dtos/error.dto';
import {
  AuthorityAuthorizationHook,
  JWTAuthenticationHook,
  Oauth2AuthenticationHook,
  SessionHeaderAuthenticationHook,
} from '@commercetools/connect-payments-sdk';
import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { getEasyCreditPaymentMethod } from '../controllers/payment.controller';
import {
  GetPaymentMethodQueryStringSchema,
  GetPaymentMethodResponseSchema,
  GetPaymentMethodResponseSchemaDTO,
} from '../dtos/payments/getPaymentMethod.dto';

type PaymentRouteOptions = {
  sessionHeaderAuthHook: SessionHeaderAuthenticationHook;
  oauth2AuthHook: Oauth2AuthenticationHook;
  jwtAuthHook: JWTAuthenticationHook;
  authorizationHook: AuthorityAuthorizationHook;
};

export const paymentsRoute = async (fastify: FastifyInstance, opts: FastifyPluginOptions & PaymentRouteOptions) => {
  fastify.get<{ Reply: GetPaymentMethodResponseSchemaDTO }>(
    '/payment-method',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        querystring: GetPaymentMethodQueryStringSchema,
        response: {
          200: GetPaymentMethodResponseSchema,
          400: ErrorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => await getEasyCreditPaymentMethod(request, reply),
  );
};
