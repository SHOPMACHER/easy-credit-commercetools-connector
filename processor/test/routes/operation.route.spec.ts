import { setupFastify } from '../../src/server/server';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { paymentSDK } from '../../src/payment-sdk';
import { isWidgetEnabled } from '../../src/services/connector.service';
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

jest.mock('../../src/services/connector.service', () => {
  const actual = jest.requireActual<typeof import('../../src/services/connector.service')>(
    '../../src/services/connector.service',
  );
  return { ...actual, isWidgetEnabled: jest.fn(actual.isWidgetEnabled) };
});

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
      expressButtonEnabled: false,
      expressButtonVisibility: 'PDP_AND_CART',
    });
  });

  describe('widget-enabled productTypeId', () => {
    const getWidgetEnabled = async (query: string) => {
      const server = await setupFastify();
      return server.inject({ method: 'GET', url: `/operations/widget-enabled${query}` });
    };
    const productTypeId = '3f2b8c1e-9d4a-4e6b-8a52-7c1d0e9f4a10';

    beforeEach(() => {
      jest.mocked(isWidgetEnabled).mockClear();
    });

    it('passes a UUID productTypeId on', async () => {
      const response = await getWidgetEnabled(`?productTypeId=${productTypeId}`);

      expect(response.statusCode).toBe(200);
      expect(isWidgetEnabled).toHaveBeenCalledWith({ productTypeId });
    });

    it.each(['voucher', 'undefined'])('rejects productTypeId=%s with 400', async (value) => {
      const response = await getWidgetEnabled(`?productTypeId=${value}`);

      expect(response.statusCode).toBe(400);
      expect(isWidgetEnabled).not.toHaveBeenCalled();
    });

    it('calls isWidgetEnabled with an empty query without a query', async () => {
      const response = await getWidgetEnabled('');

      expect(response.statusCode).toBe(200);
      expect(isWidgetEnabled).toHaveBeenCalledWith({});
    });
  });

  describe('widget placement', () => {
    const originalVisibility = process.env.WIDGET_VISIBILITY;

    afterEach(() => {
      process.env.WIDGET_VISIBILITY = originalVisibility;
    });

    it('should reject an unknown placement', async () => {
      const server = await setupFastify();

      const response = await server.inject({ method: 'GET', url: '/operations/widget-enabled?placement=cart' });

      expect(response.statusCode).toBe(400);
      expect(response.json().errors[0]).toEqual(
        expect.objectContaining({ code: 'InvalidField', fields: expect.objectContaining({ field: 'placement' }) }),
      );
    });

    it('should show the label without a query, whatever WIDGET_VISIBILITY is', async () => {
      process.env.WIDGET_VISIBILITY = 'CART';
      const server = await setupFastify();

      const response = await server.inject({ method: 'GET', url: '/operations/widget-enabled' });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).isEnabled).toBe(true);
    });

    it('should pass placement to the service', async () => {
      process.env.WIDGET_VISIBILITY = 'PDP';
      const server = await setupFastify();

      const cart = await server.inject({ method: 'GET', url: '/operations/widget-enabled?placement=CART' });
      const pdp = await server.inject({ method: 'GET', url: '/operations/widget-enabled?placement=PDP' });

      expect(cart.statusCode).toBe(200);
      expect(JSON.parse(cart.body).isEnabled).toBe(false);
      expect(JSON.parse(pdp.body).isEnabled).toBe(true);
    });

    it('should ignore other query parameters', async () => {
      process.env.WIDGET_VISIBILITY = 'PDP';
      const server = await setupFastify();

      const response = await server.inject({ method: 'GET', url: '/operations/widget-enabled?path=%2Fcart' });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).isEnabled).toBe(true);
    });
  });
});
