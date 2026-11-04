import { ErrorResponse } from '../libs/fastify/dtos/error.dto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { handleAuthorizePayment, handleCancelPayment } from '../services/payment.service';
import { log } from '../libs/logger';
import { isRedirectUrlSigned } from '../utils/redirectSignature.utils';
import {
  AuthorizePaymentResponseSchema,
  AuthorizePaymentResponseSchemaDTO,
  CancelPaymentResponseSchema,
  CancelPaymentResponseSchemaDTO,
} from '../dtos/payments/updatePaymentWebhook.dto';

type WebhookQuery = { redirectUrl?: string; sig?: string };

const WEBHOOK_QUERY_SCHEMA = {
  type: 'object',
  properties: { redirectUrl: { type: 'string' }, sig: { type: 'string' } },
};

// Redirects only to a link the connector signed for this payment, so the webhook cannot be used as an open redirect.
// Without a valid signature the work is done, but the answer is plain JSON.
const reply200OrRedirect = (reply: FastifyReply, paymentId: string, { redirectUrl, sig }: WebhookQuery) => {
  if (!redirectUrl) {
    return reply.code(200).send({ paymentId });
  }
  if (!isRedirectUrlSigned(paymentId, redirectUrl, sig)) {
    log.warn('Webhook redirect URL without a valid signature, not redirecting', { paymentId });
    return reply.code(200).send({ paymentId });
  }
  return reply.redirect(redirectUrl, 302);
};

export const webhookRoute = async (fastify: FastifyInstance) => {
  fastify.get<{
    Params: { paymentId: string };
    Querystring: WebhookQuery;
    Reply: CancelPaymentResponseSchemaDTO;
  }>(
    '/:paymentId/cancel',
    {
      schema: {
        params: { type: 'object', properties: { paymentId: { type: 'string' } }, required: ['paymentId'] },
        querystring: WEBHOOK_QUERY_SCHEMA,
        response: {
          200: CancelPaymentResponseSchema,
          400: ErrorResponse,
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { paymentId: string }; Querystring: WebhookQuery }>,
      reply: FastifyReply,
    ) => {
      const { paymentId } = request.params;

      await handleCancelPayment(paymentId);

      return reply200OrRedirect(reply, paymentId, request.query);
    },
  );

  fastify.get<{
    Params: { paymentId: string };
    Querystring: WebhookQuery;
    Reply: AuthorizePaymentResponseSchemaDTO;
  }>(
    '/:paymentId/authorize',
    {
      schema: {
        params: { type: 'object', properties: { paymentId: { type: 'string' } }, required: ['paymentId'] },
        querystring: WEBHOOK_QUERY_SCHEMA,
        response: {
          200: AuthorizePaymentResponseSchema,
          400: ErrorResponse,
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { paymentId: string }; Querystring: WebhookQuery }>,
      reply: FastifyReply,
    ) => {
      const { paymentId } = request.params;

      await handleAuthorizePayment(paymentId);

      return reply200OrRedirect(reply, paymentId, request.query);
    },
  );
};
