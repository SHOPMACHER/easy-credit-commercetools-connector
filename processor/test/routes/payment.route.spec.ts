import { authorizePayment, getEasyCreditPaymentMethod } from '../../src/controllers/payment.controller';
import { FastifyInstance } from 'fastify';
import { ErrorResponse } from '../../src/libs/fastify/dtos/error.dto';
import {
  GetPaymentMethodQueryStringSchema,
  GetPaymentMethodResponseSchema,
} from '../../src/dtos/payments/getPaymentMethod.dto';
import {
  AuthorizePaymentBodySchema,
  AuthorizePaymentResponseSchema,
} from '../../src/dtos/payments/authorizePayment.dto';
import { paymentsRoute } from '../../src/routes/payment.route';

// Mock the controllers
jest.mock('../../src/controllers/payment.controller', () => ({
  authorizePayment: jest.fn(),
  getEasyCreditPaymentMethod: jest.fn(),
}));

describe('paymentsRoute', () => {
  let fastify: FastifyInstance;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let opts: any;

  beforeEach(() => {
    fastify = {
      get: jest.fn(),
      post: jest.fn(),
    } as unknown as FastifyInstance;

    opts = {
      sessionHeaderAuthHook: {
        authenticate: jest.fn(() => jest.fn()), // Mock session header auth hook
      },
      oauth2AuthHook: {
        authenticate: jest.fn(() => jest.fn()), // Mock OAuth2 auth hook
      },
    };
  });

  it('should register GET /payment-method route with correct schema and preHandler', async () => {
    await paymentsRoute(fastify, opts);

    expect(fastify.get).toHaveBeenCalledWith(
      '/payment-method',
      expect.objectContaining({
        preHandler: [expect.any(Function)], // Use expect.any(Function) to avoid comparing actual functions
        schema: {
          querystring: GetPaymentMethodQueryStringSchema,
          response: {
            200: GetPaymentMethodResponseSchema,
            400: ErrorResponse,
          },
        },
      }),
      expect.any(Function),
    );
  });

  it('should call getEasyCreditPaymentMethod with the correct request and reply', async () => {
    const mockRequest = { query: { cartId: '123' } } as any;
    const mockReply = {} as any;
    const getEasyCreditPaymentMethodMock = getEasyCreditPaymentMethod as jest.Mock;

    await paymentsRoute(fastify, opts);
    const handler = (fastify.get as jest.Mock).mock.calls[0][2]; // Get the handler function
    await handler(mockRequest, mockReply);

    expect(getEasyCreditPaymentMethodMock).toHaveBeenCalledWith(mockRequest, mockReply);
  });

  it('should register POST /authorize route with correct schema and preHandler', async () => {
    await paymentsRoute(fastify, opts);

    expect(fastify.post).toHaveBeenCalledWith(
      '/authorize',
      expect.objectContaining({
        preHandler: [expect.any(Function)], // Use expect.any(Function) here as well
        schema: {
          body: AuthorizePaymentBodySchema,
          response: {
            200: AuthorizePaymentResponseSchema,
            400: ErrorResponse,
          },
        },
      }),
      expect.any(Function),
    );
  });

  it('should call authorizePayment with the correct request and reply', async () => {
    const mockRequest = { body: { paymentId: '456' } } as never;
    const mockReply = {} as never;
    const authorizePaymentMock = authorizePayment as jest.Mock;

    await paymentsRoute(fastify, opts);
    const handler = (fastify.post as jest.Mock).mock.calls[0][2]; // Get the handler function
    await handler(mockRequest, mockReply);

    expect(authorizePaymentMock).toHaveBeenCalledWith(mockRequest, mockReply);
  });

  it('should use session header authentication hook for GET /payment-method', async () => {
    await paymentsRoute(fastify, opts);

    const routeOptions = (fastify.get as jest.Mock).mock.calls[0][1]; // Get route options for GET
    const preHandler = routeOptions.preHandler[0];

    // Instead of comparing the function reference, check that it was called
    expect(opts.sessionHeaderAuthHook.authenticate).toHaveBeenCalled();
    expect(preHandler).toEqual(expect.any(Function));
  });

  it('should use oauth2 authentication hook for POST /authorize', async () => {
    await paymentsRoute(fastify, opts);

    const routeOptions = (fastify.post as jest.Mock).mock.calls[0][1]; // Get route options for POST
    const preHandler = routeOptions.preHandler[0];

    // Instead of comparing the function reference, check that it was called
    expect(opts.oauth2AuthHook.authenticate).toHaveBeenCalled();
    expect(preHandler).toEqual(expect.any(Function));
  });
});
