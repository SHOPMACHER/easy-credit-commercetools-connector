import { ErrorResponse } from '../libs/fastify/dtos/error.dto';
import {
  AuthorityAuthorizationHook,
  JWTAuthenticationHook,
  Oauth2AuthenticationHook,
  SessionHeaderAuthenticationHook,
} from '@commercetools/connect-payments-sdk';
import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import {
  GetPaymentMethodParamsSchema,
  GetPaymentMethodResponseSchema,
  GetPaymentMethodResponseSchemaDTO,
} from '../dtos/payments/getPaymentMethod.dto';
import {
  AuthorizePaymentBodySchema,
  AuthorizePaymentRequestSchemaDTO,
  AuthorizePaymentResponseSchema,
  AuthorizePaymentResponseSchemaDTO,
  CreatePaymentBodySchema,
  CreatePaymentRequestSchemaDTO,
  CreatePaymentResponseSchema,
  CreatePaymentResponseSchemaDTO,
} from '../dtos/payments/authorizePayment.dto';
import { handleAuthorizePayment, handleCreatePayment, handlePaymentMethod } from '../services/payment.service';

type PaymentRouteOptions = {
  sessionHeaderAuthHook: SessionHeaderAuthenticationHook;
  oauth2AuthHook: Oauth2AuthenticationHook;
  jwtAuthHook: JWTAuthenticationHook;
  authorizationHook: AuthorityAuthorizationHook;
};

export const paymentsRoute = async (fastify: FastifyInstance, opts: FastifyPluginOptions & PaymentRouteOptions) => {
  fastify.get<{ Reply: GetPaymentMethodResponseSchemaDTO; Params: { cartId: string } }>(
    '/payment-method/:cartId',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        params: GetPaymentMethodParamsSchema,
        response: {
          200: GetPaymentMethodResponseSchema,
          400: ErrorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // @ts-expect-error - params should be defined
      const { cartId } = request.params;

      const method = await handlePaymentMethod(cartId);

      reply.code(200).send(method);
    },
  );

  fastify.post<{ Body: CreatePaymentRequestSchemaDTO; Reply: CreatePaymentResponseSchemaDTO }>(
    '/',
    {
      preHandler: [opts.oauth2AuthHook.authenticate()],
      schema: {
        body: CreatePaymentBodySchema,
        response: {
          201: CreatePaymentResponseSchema,
          400: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { cartId, redirectLinks, customerRelationship } = request.body;

      const response = await handleCreatePayment(cartId, redirectLinks, customerRelationship);

      reply.code(201).send(response);
    },
  );

  fastify.post<{ Body: AuthorizePaymentRequestSchemaDTO; Reply: AuthorizePaymentResponseSchemaDTO }>(
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
    async (request, reply) => {
      const { paymentId } = request.body;

      await handleAuthorizePayment(paymentId);

      reply.code(200).send();
    },
  );
};
