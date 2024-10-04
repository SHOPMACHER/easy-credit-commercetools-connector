import { WidgetEnabledResponseSchema, WidgetEnabledResponseSchemaDTO } from './../dtos/operations/widgetEnabled.dto';
import {
  AuthorityAuthorizationHook,
  JWTAuthenticationHook,
  Oauth2AuthenticationHook,
  SessionHeaderAuthenticationHook,
} from '@commercetools/connect-payments-sdk';
import { HealthCheckResponseSchema, HealthCheckResponseSchemaDTO } from '../dtos/operations/status.dto';
import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { healthCheck, isWidgetEnabled } from '../controllers/connector.controller';

type OperationRouteOptions = {
  sessionHeaderAuthHook: SessionHeaderAuthenticationHook;
  oauth2AuthHook: Oauth2AuthenticationHook;
  jwtAuthHook: JWTAuthenticationHook;
  authorizationHook: AuthorityAuthorizationHook;
  // paymentService: AbstractPaymentService;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    async (request: FastifyRequest, reply: FastifyReply) => healthCheck(request, reply),
  );

  fastify.get<{ Reply: WidgetEnabledResponseSchemaDTO }>(
    '/widget-enabled',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      // preHandler: [],
      schema: {
        response: {
          200: WidgetEnabledResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => isWidgetEnabled(request, reply),
  );
};
