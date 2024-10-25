import { ErrorResponse } from '../libs/fastify/dtos/error.dto';
import {
  AuthorityAuthorizationHook,
  JWTAuthenticationHook,
  Oauth2AuthenticationHook,
  SessionHeaderAuthenticationHook,
} from '@commercetools/connect-payments-sdk';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
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
} from '../dtos/payments/authorizePayment.dto';
import {
  handleAuthorizeECPayment,
  handleCreatePayment,
  handlePaymentMethod,
  handleGetPayment,
} from '../services/payment.service';
import {
  GetPaymentParamsSchema,
  GetPaymentResponseSchema,
  GetPaymentResponseSchemaDTO,
} from '../dtos/payments/getPayment.dto';
import {
  CreatePaymentBodySchema,
  CreatePaymentRequestSchemaDTO,
  CreatePaymentResponseSchema,
  CreatePaymentResponseSchemaDTO,
} from '../dtos/payments/createPayment.dto';

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
    async (request, reply) => {
      const { cartId } = request.params;

      const method = await handlePaymentMethod(cartId);

      reply.code(200).send(method);
    },
  );

  fastify.post<{ Body: CreatePaymentRequestSchemaDTO; Reply: CreatePaymentResponseSchemaDTO }>(
    '/',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
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

  fastify.get<{ Params: { paymentId: string }; Reply: GetPaymentResponseSchemaDTO }>(
    '/:paymentId',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        params: GetPaymentParamsSchema,
        response: {
          200: GetPaymentResponseSchema,
          400: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { paymentId } = request.params;

      const response = await handleGetPayment(paymentId);

      reply.code(200).send(response);
    },
  );

  fastify.post<{ Body: AuthorizePaymentRequestSchemaDTO; Reply: AuthorizePaymentResponseSchemaDTO }>(
    '/authorize',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
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

      await handleAuthorizeECPayment(paymentId);

      reply.code(200).send();
    },
  );
};
