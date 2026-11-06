import { ErrorResponse } from '../libs/fastify/dtos/error.dto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { handleAuthorizePayment, handleCancelPayment } from '../services/payment.service';
import {
  AuthorizePaymentResponseSchema,
  AuthorizePaymentResponseSchemaDTO,
  CancelPaymentResponseSchema,
  CancelPaymentResponseSchemaDTO,
} from '../dtos/payments/updatePaymentWebhook.dto';
import { Errorx } from '@commercetools/connect-payments-sdk';
import { isValidRedirectSignature } from '../utils/redirect.utils';
import { log } from '../libs/logger';

export const webhookRoute = async (fastify: FastifyInstance) => {
  fastify.get<{
    Params: { paymentId: string };
    Querystring: { redirectUrl?: string; sig?: string };
    Reply: CancelPaymentResponseSchemaDTO;
  }>(
    '/:paymentId/cancel',
    {
      schema: {
        params: { type: 'object', properties: { paymentId: { type: 'string' } }, required: ['paymentId'] },
        querystring: { type: 'object', properties: { redirectUrl: { type: 'string' }, sig: { type: 'string' } } },
        response: {
          200: CancelPaymentResponseSchema,
          400: ErrorResponse,
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { paymentId: string }; Querystring: { redirectUrl?: string; sig?: string } }>,
      reply: FastifyReply,
    ) => {
      const { paymentId } = request.params;
      const { redirectUrl, sig } = request.query;

      // This route is public and browser-reachable, so only follow redirect URLs the connector signed itself.
      if (redirectUrl && !isValidRedirectSignature(paymentId, redirectUrl, sig)) {
        throw new Errorx({
          code: 'InvalidRedirectUrl',
          message: 'Invalid redirect URL signature.',
          httpErrorStatus: 400,
        });
      }

      if (!redirectUrl) {
        await handleCancelPayment(paymentId);

        return reply.code(200).send({ paymentId });
      }

      // A shopper's browser lands here, so never strand it on an error page; the payment state stays as the service left it.
      await handleCancelPayment(paymentId).catch((error: unknown) =>
        log.error('Cancel failed, redirecting back to the shop anyway', { paymentId, error }),
      );

      return reply.redirect(redirectUrl, 302);
    },
  );

  // Called server to server by easyCredit once the purchase is authorized; it never carries a redirect.
  fastify.get<{ Params: { paymentId: string }; Reply: AuthorizePaymentResponseSchemaDTO }>(
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
    async (request: FastifyRequest<{ Params: { paymentId: string } }>, reply: FastifyReply) => {
      const { paymentId } = request.params;

      await handleAuthorizePayment(paymentId);

      return reply.code(200).send({ paymentId });
    },
  );
};
