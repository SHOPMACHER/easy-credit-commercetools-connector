import { setupFastify } from '../../src/server/server';
import { describe, expect, it, jest } from '@jest/globals';
import { paymentSDK } from '../../src/payment-sdk';
import { initEasyCreditClient } from '../../src/client/easycredit.client';

jest.mock('../../src/payment-sdk.ts', () => ({
  paymentSDK: {
    jwtAuthHookFn: {
      authenticate: jest.fn(),
    },
    oauth2AuthHookFn: {
      authenticate: jest.fn(),
    },
    sessionHeaderAuthHookFn: {
      authenticate: jest.fn(),
    },
    authorityAuthorizationHookFn: {
      authenticate: jest.fn(),
    },
  },
}));
jest.mock('../../src/client/easycredit.client.ts', () => ({
  initEasyCreditClient: jest.fn(),
}));

describe('test operationRoute', () => {
  it('should call healthCheck handler', async () => {
    (paymentSDK.sessionHeaderAuthHookFn.authenticate as unknown as jest.Mock).mockImplementation(() => {
      return async () => {};
    });
    (paymentSDK.oauth2AuthHookFn.authenticate as unknown as jest.Mock).mockImplementation(() => {
      return async () => {};
    });

    (initEasyCreditClient as jest.Mock).mockReturnValue({
      integrationCheck: jest.fn().mockResolvedValue({ success: true } as never),
    });

    const server = await setupFastify();

    const response = await server.inject({
      method: 'GET',
      url: `/operations/health-check`,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toStrictEqual({
      message: 'The connector is running healthily and connected to EasyCredit.',
    });
  });

  it('should call isWidgetEnabled handler', async () => {
    (paymentSDK.sessionHeaderAuthHookFn.authenticate as unknown as jest.Mock).mockImplementation(() => {
      return async () => {};
    });

    const server = await setupFastify();

    const response = await server.inject({
      method: 'GET',
      url: `/operations/widget-enabled`,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toStrictEqual({
      isEnabled: process.env.WIDGET_ENABLED === '1',
      webShopId: process.env.WEBSHOP_ID,
    });
  });
});
