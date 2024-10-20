import { FastifyRequest, FastifyReply } from 'fastify';
import { handlePaymentMethod, handleAuthorizePayment } from '../services/payment.service';

export const getEasyCreditPaymentMethod = async (
  request: FastifyRequest<{ Querystring: { cartId: string } }>,
  reply: FastifyReply,
) => {
  reply.code(200).send(await handlePaymentMethod(request.query.cartId as string));
};

export const authorizePayment = async (
  request: FastifyRequest<{ Body: { paymentId: string } }>,
  reply: FastifyReply,
) => {
  reply.code(200).send(await handleAuthorizePayment(request.body.paymentId as string));
};
