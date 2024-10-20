import { ErrorResponse } from '../libs/fastify/dtos/error.dto';
import {
  AuthorityAuthorizationHook,
  JWTAuthenticationHook,
  Oauth2AuthenticationHook,
  SessionHeaderAuthenticationHook,
} from '@commercetools/connect-payments-sdk';
import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { authorizePayment, getEasyCreditPaymentMethod } from '../controllers/payment.controller';
import {
  GetPaymentMethodQueryStringSchema,
  GetPaymentMethodResponseSchema,
  GetPaymentMethodResponseSchemaDTO,
} from '../dtos/payments/getPaymentMethod.dto';
import {
  AuthorizePaymentBodySchema,
  AuthorizePaymentResponseSchema,
  AuthorizePaymentResponseSchemaDTO,
} from '../dtos/payments/authorizePayment.dto';

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
    async (request: FastifyRequest, reply: FastifyReply) =>
      await getEasyCreditPaymentMethod(request as FastifyRequest<{ Querystring: { cartId: string } }>, reply),
  );

  fastify.post<{ Reply: AuthorizePaymentResponseSchemaDTO }>(
    '/authorize',
    {
      preHandler: [opts.oauth2AuthHook.authenticate()],
      schema: {
        body: AuthorizePaymentBodySchema,
        response: {
          200: AuthorizePaymentResponseSchema,
          400: ErrorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) =>
      await authorizePayment(request as FastifyRequest<{ Body: { paymentId: string } }>, reply),
  );
};
