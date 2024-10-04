import { GetOptionResponseSchema, GetOptionResponseSchemaDTO } from './../dtos/payments/getOption.dto';
import {
  AuthorityAuthorizationHook,
  JWTAuthenticationHook,
  Oauth2AuthenticationHook,
  SessionHeaderAuthenticationHook,
} from '@commercetools/connect-payments-sdk';
import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { getEasyCreditPaymentMethod } from '../controllers/payment.controller';
import { GetOptionQueryStringSchema } from '../dtos/payments/getOption.dto';

type OperationRouteOptions = {
  sessionHeaderAuthHook: SessionHeaderAuthenticationHook;
  oauth2AuthHook: Oauth2AuthenticationHook;
  jwtAuthHook: JWTAuthenticationHook;
  authorizationHook: AuthorityAuthorizationHook;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const paymentsRoute = async (fastify: FastifyInstance, opts: FastifyPluginOptions & OperationRouteOptions) => {
  fastify.get<{ Reply: GetOptionResponseSchemaDTO }>(
    '/payment-method',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        querystring: GetOptionQueryStringSchema,
        response: {
          200: GetOptionResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => await getEasyCreditPaymentMethod(request, reply),
  );
};
