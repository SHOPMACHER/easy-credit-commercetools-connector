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
import {
  handleAuthorizePayment,
  handleCancelPayment,
  handleCreatePayment,
  handlePaymentMethod
} from '../services/payment.service';
import {CancelPaymentResponseSchema, CancelPaymentResponseSchemaDTO} from "../dtos/payments/updatePaymentMethod.dto";

type PaymentRouteOptions = {
  sessionHeaderAuthHook: SessionHeaderAuthenticationHook;
  oauth2AuthHook: Oauth2AuthenticationHook;
  jwtAuthHook: JWTAuthenticationHook;
  authorizationHook: AuthorityAuthorizationHook;
};

export const webhookRoute = async (fastify: FastifyInstance, opts: FastifyPluginOptions & PaymentRouteOptions) => {
  fastify.post<{ Params: { paymentId: string }; Querystring: { redirectUrl: string }; Reply: CancelPaymentResponseSchemaDTO }>(
      '/:paymentId/cancel',
      {
        schema: {
          params: { type: 'object', properties: { paymentId: { type: 'string' } }, required: ['paymentId'] },
          querystring: { type: 'object', properties: { redirectUrl: { type: 'string' } }, required: ['redirectUrl'] },
          response: {
            200: CancelPaymentResponseSchema,
            400: ErrorResponse,
          },
        },
      },
      async (request: FastifyRequest<{ Params: { paymentId: string }; Querystring: { redirectUrl: string } }>, reply: FastifyReply) => {
        const { paymentId } = request.params;
        const { redirectUrl } = request.query;

        await handleCancelPayment(paymentId);

        return reply.redirect(redirectUrl, 302);
      },
  );
};
