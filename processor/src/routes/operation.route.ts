import {
  WidgetEnabledQuerySchema,
  WidgetEnabledQuerySchemaDTO,
  WidgetEnabledResponseSchema,
  WidgetEnabledResponseSchemaDTO,
} from './../dtos/operations/widgetEnabled.dto';
import { HealthCheckResponseSchema, HealthCheckResponseSchemaDTO } from '../dtos/operations/status.dto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { healthCheck, isWidgetEnabled } from '../services/connector.service';

export const operationsRoute = async (fastify: FastifyInstance) => {
  fastify.get<{ Reply: HealthCheckResponseSchemaDTO }>(
    '/health-check',
    {
      preHandler: [],
      schema: {
        response: {
          200: HealthCheckResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await healthCheck();

      reply.code(200).send({ message: 'The connector is running healthily and connected to EasyCredit.' });
    },
  );

  // Public: shoppers without a cart have no checkout session.
  fastify.get<{ Querystring: WidgetEnabledQuerySchemaDTO; Reply: WidgetEnabledResponseSchemaDTO }>(
    '/widget-enabled',
    {
      schema: {
        querystring: WidgetEnabledQuerySchema,
        response: {
          200: WidgetEnabledResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.code(200).send(await isWidgetEnabled(request.query));
    },
  );
};
