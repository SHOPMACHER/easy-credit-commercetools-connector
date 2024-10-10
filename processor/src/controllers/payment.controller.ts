import { FastifyRequest, FastifyReply } from 'fastify';
import { handleGetEasyCreditPaymentMethod } from '../services/payment.service';

export const getEasyCreditPaymentMethod = async (request: FastifyRequest, reply: FastifyReply) => {
  const params: { [key: string]: unknown } = { ...(request.query as object) };

  reply.code(200).send(await handleGetEasyCreditPaymentMethod(params?.cartId as string));
};
