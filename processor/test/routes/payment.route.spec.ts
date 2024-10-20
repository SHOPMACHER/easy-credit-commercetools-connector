import { paymentsRoute } from '../../src/routes/payment.route';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { handleAuthorizePayment, handleCreatePayment, handlePaymentMethod } from '../../src/services/payment.service';

jest.mock('../../src/services/payment.service');

describe('paymentsRoute', () => {
  let fastify: Partial<FastifyInstance>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sessionHeaderAuthHookMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let oauth2AuthHookMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let opts: any;

  beforeEach(() => {
    fastify = {
      get: jest.fn(),
      post: jest.fn(),
    };

    sessionHeaderAuthHookMock = { authenticate: jest.fn(() => jest.fn()) };
    oauth2AuthHookMock = { authenticate: jest.fn(() => jest.fn()) };

    opts = {
      sessionHeaderAuthHook: sessionHeaderAuthHookMock,
      oauth2AuthHook: oauth2AuthHookMock,
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should register the payment-method GET route', async () => {
    await paymentsRoute(fastify as FastifyInstance, opts);

    expect(fastify.get).toHaveBeenCalledWith(
      '/payment-method/:cartId',
      expect.objectContaining({
        preHandler: expect.arrayContaining([expect.any(Function)]), // Expect an array containing a function
        schema: expect.objectContaining({
          params: expect.any(Object), // Allow any object structure
          response: expect.objectContaining({
            200: expect.any(Object), // Allow any object structure
            400: expect.any(Object), // Allow any object structure
          }),
        }),
      }),
      expect.any(Function), // Route handler function
    );

    // Test the route handler
    const routeHandler = (fastify.get as jest.Mock).mock.calls[0][2];
    const requestMock = { params: { cartId: '123' } } as Partial<FastifyRequest>;
    const replyMock = { code: jest.fn().mockReturnThis(), send: jest.fn() } as unknown as FastifyReply;

    (handlePaymentMethod as jest.Mock).mockResolvedValue({ method: 'mockMethod' });

    await routeHandler(requestMock, replyMock);

    expect(handlePaymentMethod).toHaveBeenCalledWith('123');
    expect(replyMock.code).toHaveBeenCalledWith(200);
    expect(replyMock.send).toHaveBeenCalledWith({ method: 'mockMethod' });
  });

  it('should register the payment POST route', async () => {
    await paymentsRoute(fastify as FastifyInstance, opts);

    expect(fastify.post).toHaveBeenCalledWith(
      '/',
      expect.objectContaining({
        preHandler: expect.arrayContaining([expect.any(Function)]), // Expect an array containing a function
        schema: expect.objectContaining({
          body: expect.any(Object),
          response: expect.objectContaining({
            201: expect.any(Object),
            400: expect.any(Object),
          }),
        }),
      }),
      expect.any(Function), // Route handler function
    );

    // Test the route handler
    const routeHandler = (fastify.post as jest.Mock).mock.calls[0][2];
    const requestMock = {
      body: { cartId: '123', redirectLinks: 'mockLink', customerRelationship: 'mockRelationship' },
    } as Partial<FastifyRequest>;
    const replyMock = { code: jest.fn().mockReturnThis(), send: jest.fn() } as unknown as FastifyReply;

    (handleCreatePayment as jest.Mock).mockResolvedValue({ payment: 'mockPayment' });

    await routeHandler(requestMock, replyMock);

    expect(handleCreatePayment).toHaveBeenCalledWith('123', 'mockLink', 'mockRelationship');
    expect(replyMock.code).toHaveBeenCalledWith(201);
    expect(replyMock.send).toHaveBeenCalledWith({ payment: 'mockPayment' });
  });

  it('should register the authorize POST route', async () => {
    await paymentsRoute(fastify as FastifyInstance, opts);

    expect(fastify.post).toHaveBeenCalledWith(
      '/authorize',
      expect.objectContaining({
        preHandler: expect.arrayContaining([expect.any(Function)]), // Expect an array containing a function
        schema: expect.objectContaining({
          body: expect.any(Object),
          response: expect.objectContaining({
            200: expect.any(Object),
            400: expect.any(Object),
          }),
        }),
      }),
      expect.any(Function), // Route handler function
    );

    // Test the route handler
    const routeHandler = (fastify.post as jest.Mock).mock.calls[1][2];
    const requestMock = { body: { paymentId: 'abc123' } } as Partial<FastifyRequest>;
    const replyMock = { code: jest.fn().mockReturnThis(), send: jest.fn() } as unknown as FastifyReply;

    await routeHandler(requestMock, replyMock);

    expect(handleAuthorizePayment).toHaveBeenCalledWith('abc123');
    expect(replyMock.code).toHaveBeenCalledWith(200);
    expect(replyMock.send).toHaveBeenCalled();
  });
});
