import { easyCreditRoutes } from './../../src/routes/easycreditNotification.route';
import { handleEasyCreditNotification } from './../../src/services/easycreditNotification.service';
import fastify from 'fastify';
import { describe, jest, it, expect, afterEach, beforeAll, afterAll } from '@jest/globals';

// Mocks for imported service functions
jest.mock('../../src/services/easycreditNotification.service.ts', () => ({
  handleEasyCreditNotification: jest.fn(),
}));

describe('easycreditNotificationRoutes', () => {
  const app = fastify({ logger: false });

  beforeAll(async () => {
    await app.register(easyCreditRoutes, {
      prefix: '/easycredit-notification',
    });
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /easycredit-notification/:resourceId', () => {
    it('should return payment method config', async () => {
      const resourceId = '12345';

      // @ts-expect-error mocked
      (handleEasyCreditNotification as jest.Mock).mockResolvedValue({});

      const response = await app.inject({
        method: 'GET',
        url: `/easycredit-notification/${resourceId}`,
        headers: {
          'content-type': 'application/json',
        },
      });

      expect(response.statusCode).toBe(204);
      expect(handleEasyCreditNotification).toHaveBeenCalledWith(resourceId);
    });
  });
});
