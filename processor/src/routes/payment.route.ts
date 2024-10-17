import { ErrorResponse } from '../libs/fastify/dtos/error.dto';
import {
    AuthorityAuthorizationHook,
    JWTAuthenticationHook,
    Oauth2AuthenticationHook,
    SessionHeaderAuthenticationHook,
} from '@commercetools/connect-payments-sdk';
import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { authorizePayment, getEasyCreditPaymentMethod } from '../controllers/payment.controller';
import {
    GetPaymentMethodQueryStringSchema,
    GetPaymentMethodResponseSchema,
    GetPaymentMethodResponseSchemaDTO,
} from '../dtos/payments/getPaymentMethod.dto';
import {
    AuthorizePaymentBodySchema,
    AuthorizePaymentResponseSchema,
    AuthorizePaymentResponseSchemaDTO,
} from '../dtos/payments/authorizePayment.dto';
import {
    CancelPaymentResponseSchema, CancelPaymentResponseSchemaDTO,
    DeniedPaymentResponseSchema, DeniedPaymentResponseSchemaDTO,
} from '../dtos/payments/updatePaymentMethod.dto';
import {handleCancelPayment, handleDeniedPayment} from "../services/payment.service";

type PaymentRouteOptions = {
    sessionHeaderAuthHook: SessionHeaderAuthenticationHook;
    oauth2AuthHook: Oauth2AuthenticationHook;
    jwtAuthHook: JWTAuthenticationHook;
    authorizationHook: AuthorityAuthorizationHook;
};

export const paymentsRoute = async (fastify: FastifyInstance, opts: FastifyPluginOptions & PaymentRouteOptions) => {
    fastify.get<{ Reply: GetPaymentMethodResponseSchemaDTO }>(
        '/payment-method',
        {
            preHandler: [opts.sessionHeaderAuthHook.authenticate()],
            schema: {
                querystring: GetPaymentMethodQueryStringSchema,
                response: {
                    200: GetPaymentMethodResponseSchema,
                    400: ErrorResponse,
                },
            },
        },
        async (request: FastifyRequest, reply: FastifyReply) =>
            await getEasyCreditPaymentMethod(request as FastifyRequest<{ Querystring: { cartId: string } }>, reply),
    );

    fastify.post<{ Reply: AuthorizePaymentResponseSchemaDTO }>(
        '/authorize',
        {
            preHandler: [opts.oauth2AuthHook.authenticate()],
            schema: {
                body: AuthorizePaymentBodySchema,
                response: {
                    200: AuthorizePaymentResponseSchema,
                    400: ErrorResponse,
                },
            },
        },
        async (request: FastifyRequest, reply: FastifyReply) =>
            await authorizePayment(request as FastifyRequest<{ Body: { paymentId: string } }>, reply),
    );

    fastify.post<{
        Params: { paymentId: string };
        Querystring: { redirectUrl: string };
        Reply: CancelPaymentResponseSchemaDTO;
    }>(
        '/cancel/:paymentId',
        {
            preHandler: [opts.oauth2AuthHook.authenticate()],
            schema: {
                params: { type: 'object', properties: { paymentId: { type: 'string' } }, required: ['paymentId'] },
                querystring: { type: 'object', properties: { redirectUrl: { type: 'string' } }, required: ['redirectUrl'] },
                response: {
                    200: CancelPaymentResponseSchema,
                    400: ErrorResponse,
                },
            },
        },
        async (request: FastifyRequest<{ Params: { paymentId: string }; Querystring: { redirectUrl: string } }>, reply: FastifyReply) => {
            const { paymentId } = request.params;
            const { redirectUrl } = request.query;

            await handleCancelPayment(paymentId);

            // Redirect to the specified URL after cancellation
            return reply.redirect(redirectUrl, 302);
        },
    );

    fastify.post<{
        Params: { paymentId: string };
        Querystring: { redirectUrl: string };
        Reply: DeniedPaymentResponseSchemaDTO
    }>(
        '/denied/:paymentId',
        {
            schema: {
                params: { type: 'object', properties: { paymentId: { type: 'string' } }, required: ['paymentId'] },
                querystring: { type: 'object', properties: { redirectUrl: { type: 'string' } }, required: ['redirectUrl'] },
                response: {
                    200: DeniedPaymentResponseSchema,
                    400: ErrorResponse,
                },
            },
        },
        async (request: FastifyRequest<{ Params: { paymentId: string }; Querystring: { redirectUrl: string } }>, reply: FastifyReply) => {
            const { paymentId } = request.params;
            const { redirectUrl } = request.query;

            await handleDeniedPayment(paymentId);

            // Redirect to the specified URL after denial
            return reply.redirect(redirectUrl, 302);
        },
    );

};
