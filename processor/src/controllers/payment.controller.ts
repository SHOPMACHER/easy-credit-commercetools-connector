import { FastifyRequest, FastifyReply } from 'fastify';
import { handlePaymentMethod } from '../services/payment.service';

export const getEasyCreditPaymentMethod = async (request: FastifyRequest, reply: FastifyReply) => {
  const params: { [key: string]: unknown } = { ...(request.query as object) };

  reply.code(200).send(await handlePaymentMethod(params?.cartId as string));
};
