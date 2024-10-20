import { WidgetEnabledResponseSchema, WidgetEnabledResponseSchemaDTO } from './../dtos/operations/widgetEnabled.dto';
import {
  AuthorityAuthorizationHook,
  JWTAuthenticationHook,
  Oauth2AuthenticationHook,
  SessionHeaderAuthenticationHook,
} from '@commercetools/connect-payments-sdk';
import { HealthCheckResponseSchema, HealthCheckResponseSchemaDTO } from '../dtos/operations/status.dto';
import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { healthCheck, isWidgetEnabled } from '../services/connector.service';

type OperationRouteOptions = {
  sessionHeaderAuthHook: SessionHeaderAuthenticationHook;
  oauth2AuthHook: Oauth2AuthenticationHook;
  jwtAuthHook: JWTAuthenticationHook;
  authorizationHook: AuthorityAuthorizationHook;
};

export const operationsRoute = async (fastify: FastifyInstance, opts: FastifyPluginOptions & OperationRouteOptions) => {
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

  fastify.get<{ Reply: WidgetEnabledResponseSchemaDTO }>(
    '/widget-enabled',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        response: {
          200: WidgetEnabledResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      reply.code(200).send(await isWidgetEnabled());
    },
  );
};
