import { initEasyCreditClient } from './../../src/client/easycredit.client';
import { healthCheck, isWidgetEnabled } from './../../src/controllers/connector.controller';
import { describe, jest, beforeEach, afterEach, it, expect } from '@jest/globals';
import { log } from '../../src/libs/logger';
import { FastifyReply, FastifyRequest } from 'fastify';
import { errorHandler } from '../../src/libs/fastify/error-handler';
import { readConfiguration } from '../../src/utils/config.utils';

jest.mock('../../src/client/easycredit.client.ts', () => ({
  initEasyCreditClient: jest.fn(),
}));

describe('healthCheck', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  jest.spyOn(require('../../src/libs/fastify/error-handler'), 'errorHandler');

  let req: Partial<FastifyRequest>;
  let res: Partial<FastifyReply>;

  beforeEach(() => {
    res = {
      // @ts-expect-error: ignore type error
      code: jest.fn().mockReturnThis(),
      // @ts-expect-error: ignore type error
      send: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return status code 200 with a successful health check response', async () => {
    req = {};

    const mockIntegrationCheck = jest.fn().mockResolvedValue({ success: true } as never);

    (initEasyCreditClient as jest.Mock).mockReturnValue({
      integrationCheck: mockIntegrationCheck,
    });

    await healthCheck(req as FastifyRequest, res as FastifyReply);
    expect(log.debug).toBeCalledTimes(1);
    expect(log.debug).toHaveBeenCalledWith('healthCheck - The connector is running healthily.');
    expect(res.code).toBeCalledWith(200);
    expect(res.send).toBeCalledWith({
      message: 'The connector is running healthily and connected to EasyCredit.',
    });
  });

  it('should call the errorHandler when an error was thrown', async () => {
    try {
      req = {};
      (res.send as jest.Mock).mockImplementation(() => {
        throw new Error('Dummy error');
      });

      await healthCheck(req as FastifyRequest, res as FastifyReply);
    } catch (error) {
      expect(errorHandler).toBeCalledTimes(1);
      expect(errorHandler).toBeCalledWith(error, req, res);
    }
  });
});

describe('isWidgetEnabled', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  jest.spyOn(require('../../src/utils/config.utils'), 'readConfiguration');

  let req: Partial<FastifyRequest>;
  let res: Partial<FastifyReply>;

  beforeEach(() => {
    res = {
      // @ts-expect-error: ignore type error
      code: jest.fn().mockReturnThis(),
      // @ts-expect-error: ignore type error
      send: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return status code 200 with a widget and webshop id config', async () => {
    req = {};
    await isWidgetEnabled(req as FastifyRequest, res as FastifyReply);
    expect(readConfiguration).toBeCalledTimes(1);
    expect(log.debug).toBeCalledTimes(1);
    expect(log.debug).toHaveBeenCalledWith('get PDP Widget config');
    expect(res.code).toBeCalledWith(200);
    expect(res.send).toBeCalledWith({
      isEnabled: process.env.WIDGET_ENABLED === '1' ? true : false,
      webShopId: process.env.WEBSHOP_ID,
    });
  });
});
