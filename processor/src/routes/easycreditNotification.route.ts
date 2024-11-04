import { handleEasyCreditNotification } from './../services/easycreditNotification.service';
import { GetEasyCreditNotificationResponseSchemaDTO } from './../dtos/easycreditNotification/getEasyCreditNotification.dto';
import { ErrorResponse } from '../libs/fastify/dtos/error.dto';
import { FastifyInstance } from 'fastify';
import {
  GetEasyCreditNotificationParamsSchema,
  GetEasyCreditNotificationResponseSchema,
} from '../dtos/easycreditNotification/getEasyCreditNotification.dto';

export const easyCreditRoutes = async (fastify: FastifyInstance) => {
  fastify.get<{ Reply: GetEasyCreditNotificationResponseSchemaDTO; Params: { resourceId: string } }>(
    '/:resourceId',
    {
      schema: {
        params: GetEasyCreditNotificationParamsSchema,
        response: {
          204: GetEasyCreditNotificationResponseSchema,
          400: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { resourceId } = request.params;

      await handleEasyCreditNotification(resourceId);

      reply.code(204).send();
    },
  );
};
