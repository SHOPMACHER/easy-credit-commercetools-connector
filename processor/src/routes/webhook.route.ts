import { ErrorResponse } from '../libs/fastify/dtos/error.dto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { handleAuthorizePayment, handleCancelPayment } from '../services/payment.service';
import {
  AuthorizePaymentResponseSchema,
  AuthorizePaymentResponseSchemaDTO,
  CancelPaymentResponseSchema,
  CancelPaymentResponseSchemaDTO,
} from '../dtos/payments/updatePaymentWebhook.dto';

export const webhookRoute = async (fastify: FastifyInstance) => {
  fastify.get<{
    Params: { paymentId: string };
    Querystring: { redirectUrl: string };
    Reply: CancelPaymentResponseSchemaDTO;
  }>(
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
    async (
      request: FastifyRequest<{ Params: { paymentId: string }; Querystring: { redirectUrl: string } }>,
      reply: FastifyReply,
    ) => {
      const { paymentId } = request.params;
      const { redirectUrl } = request.query;

      await handleCancelPayment(paymentId);

      if (!redirectUrl) {
        return reply.code(200).send({ paymentId });
      }
      return reply.redirect(decodeURIComponent(redirectUrl), 302);
    },
  );

  fastify.get<{
    Params: { paymentId: string };
    Querystring: { redirectUrl: string };
    Reply: AuthorizePaymentResponseSchemaDTO;
  }>(
    '/:paymentId/authorize',
    {
      schema: {
        params: { type: 'object', properties: { paymentId: { type: 'string' } }, required: ['paymentId'] },
        response: {
          200: AuthorizePaymentResponseSchema,
          400: ErrorResponse,
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { paymentId: string }; Querystring: { redirectUrl: string } }>,
      reply: FastifyReply,
    ) => {
      const { paymentId } = request.params;
      const { redirectUrl } = request.query;

      await handleAuthorizePayment(paymentId);

      if (!redirectUrl) {
        return reply.code(200).send({ paymentId });
      }

      return reply.redirect(decodeURIComponent(redirectUrl), 302);
    },
  );
};
