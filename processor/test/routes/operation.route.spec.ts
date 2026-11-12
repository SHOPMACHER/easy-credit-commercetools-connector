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
      authorize: jest.fn(() => async () => {}),
    },
  },
}));
jest.mock('../../src/client/easycredit.client.ts', () => ({
  initEasyCreditClient: jest.fn(),
}));
// Keeps the widget route independent of the webshop config cache and the easyCredit client.
jest.mock('../../src/services/webshop.service', () => ({
  getPaymentTypesAvailability: jest.fn(async () => ({
    INSTALLMENT_PAYMENT: { enabled: true, available: true },
    BILL_PAYMENT: { enabled: true, available: true },
  })),
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

  it('should call isWidgetEnabled handler without a checkout session', async () => {
    (paymentSDK.sessionHeaderAuthHookFn.authenticate as unknown as jest.Mock).mockImplementation(() => {
      return async () => {
        throw new Error('Session is not active');
      };
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
      paymentTypes: process.env.WIDGET_ENABLED === '1' ? ['INSTALLMENT_PAYMENT', 'BILL_PAYMENT'] : [],
    });
  });
});
