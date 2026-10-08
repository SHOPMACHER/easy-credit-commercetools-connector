import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { getPaymentTypesAvailability, resetWebshopInfoCache } from '../../src/services/webshop.service';

const webshopInfo = {
  availability: true,
  installmentPaymentActive: true,
  minInstallmentValue: 200,
  maxInstallmentValue: 10000,
  billPaymentActive: true,
  minBillingValue: 50,
  maxBillingValue: 5000,
};

// Keep the client, JSON parsing, schema validation and cache real; only mock HTTP requests.
describe('webshop refresh with the easyCredit client', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    process.env.BILL_PAYMENT_ENABLED = '1';
    process.env.WEBSHOP_CACHE_TTL = '300';
    jest.useFakeTimers({ now: 0 });
    resetWebshopInfoCache();
    fetchMock = jest.spyOn(global, 'fetch');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(webshopInfo), { status: 200 }));

    await getPaymentTypesAvailability(500);
    jest.setSystemTime(300001);
  });

  afterEach(() => {
    resetWebshopInfoCache();
    jest.restoreAllMocks();
    jest.useRealTimers();
    process.env = originalEnv;
  });

  it.each([
    [401, 'null'],
    [403, 'null'],
    [404, 'null'],
    [200, '<html>Invalid JSON</html>'],
  ])('should discard stale data after HTTP %s with body %s', async (status, body) => {
    fetchMock.mockResolvedValueOnce(new Response(body, { status }));
    const unavailable = {
      code: 'EasyCreditUnavailable',
      httpErrorStatus: 503,
      fields: { webShopId: process.env.WEBSHOP_ID },
    };

    await expect(getPaymentTypesAvailability(500)).rejects.toMatchObject(unavailable);
    await expect(getPaymentTypesAvailability(500)).rejects.toMatchObject(unavailable);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // A later network failure must not resurrect the invalidated configuration.
    jest.setSystemTime(330001);
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(getPaymentTypesAvailability(500)).rejects.toMatchObject(unavailable);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    [503, 'null'],
    [503, '<html>Service unavailable</html>'],
    [408, 'null'],
    [429, 'null'],
  ])('should still use stale installment data after HTTP %s with body %s', async (status, body) => {
    fetchMock.mockResolvedValueOnce(new Response(body, { status }));

    await expect(getPaymentTypesAvailability(500)).resolves.toEqual({
      INSTALLMENT_PAYMENT: { enabled: true, available: true, minAmount: 200, maxAmount: 10000 },
      BILL_PAYMENT: { enabled: false, available: false, minAmount: 50, maxAmount: 5000 },
    });
  });
});
