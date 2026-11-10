import { ErrorResponse } from '../libs/fastify/dtos/error.dto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { handleAuthorizePayment, handleCancelPayment, TRANSACTION_IS_AUTHORIZED } from '../services/payment.service';
import {
  AuthorizePaymentResponseSchema,
  AuthorizePaymentResponseSchemaDTO,
  CancelPaymentResponseSchema,
  CancelPaymentResponseSchemaDTO,
} from '../dtos/payments/updatePaymentWebhook.dto';
import { Errorx } from '@commercetools/connect-payments-sdk';
import { isValidRedirectSignature } from '../utils/redirect.utils';
import { log } from '../libs/logger';

type CancelQuery = { redirectUrl?: string; successUrl?: string; sig?: string };

// Lets the shop tell a failed cancel apart from a successful one and show a message.
const withCancelError = (url: string): string => {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('error', 'cancel_failed');
    return parsed.toString();
  } catch {
    // Relative shop URLs get no flag: URL needs an absolute base to edit the query safely.
    return url;
  }
};

export const webhookRoute = async (fastify: FastifyInstance) => {
  fastify.get<{
    Params: { paymentId: string };
    Querystring: CancelQuery;
    Reply: CancelPaymentResponseSchemaDTO;
  }>(
    '/:paymentId/cancel',
    {
      schema: {
        params: { type: 'object', properties: { paymentId: { type: 'string' } }, required: ['paymentId'] },
        querystring: {
          type: 'object',
          properties: { redirectUrl: { type: 'string' }, successUrl: { type: 'string' }, sig: { type: 'string' } },
        },
        response: {
          200: CancelPaymentResponseSchema,
          400: ErrorResponse,
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { paymentId: string }; Querystring: CancelQuery }>,
      reply: FastifyReply,
    ) => {
      const { paymentId } = request.params;
      const { redirectUrl, successUrl, sig } = request.query;

      // This route is public and browser-reachable, so only follow redirect URLs the connector signed itself.
      if (redirectUrl && !isValidRedirectSignature(paymentId, redirectUrl, successUrl, sig)) {
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

      // A shopper's browser lands here, so always go back to the shop; the payment state stays as the service left it.
      const target = await handleCancelPayment(paymentId).then(
        () => redirectUrl,
        (error: unknown) => {
          if (error instanceof Errorx && error.code === TRANSACTION_IS_AUTHORIZED && successUrl) {
            log.info('Cancel link used for an authorized payment, redirecting to the success page', { paymentId });
            return successUrl;
          }
          log.error('Cancel failed, redirecting back to the shop with an error flag', { paymentId, error });
          return withCancelError(redirectUrl);
        },
      );

      return reply.redirect(target, 302);
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
