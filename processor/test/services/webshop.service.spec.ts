import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Errorx } from '@commercetools/connect-payments-sdk';
import { initEasyCreditClient } from '../../src/client/easycredit.client';
import { log } from '../../src/libs/logger';
import { readConfiguration } from '../../src/utils/config.utils';
import { getPaymentTypesAvailability, getWebshopInfo, resetWebshopInfoCache } from '../../src/services/webshop.service';
import { ECWebshopInfo } from '../../src/types/payment.types';

jest.mock('../../src/client/easycredit.client');
jest.mock('../../src/utils/config.utils');

const webshopInfo: ECWebshopInfo = {
  availability: true,
  billPaymentActive: true,
  installmentPaymentActive: true,
  minBillingValue: 50,
  maxBillingValue: 5000,
  minInstallmentValue: 200,
  maxInstallmentValue: 10000,
};

const fresh = { data: webshopInfo, isStale: false };
const stale = { data: webshopInfo, isStale: true };

describe('webshop.service', () => {
  let getWebshopInfoMock: jest.Mock<() => Promise<unknown>>;

  const mockConfig = (billPaymentEnabled = '1', webshopCacheTtl = '300', webShopId = 'webShopId123') => {
    (readConfiguration as jest.Mock).mockReturnValue({
      easyCredit: { webShopId, billPaymentEnabled, webshopCacheTtl },
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    resetWebshopInfoCache();
    mockConfig();
    getWebshopInfoMock = jest.fn<() => Promise<unknown>>().mockResolvedValue(webshopInfo);
    (initEasyCreditClient as jest.Mock).mockReturnValue({ getWebshopInfo: getWebshopInfoMock });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getWebshopInfo', () => {
    it('should cache each webshop configuration independently', async () => {
      const otherWebshop = { ...webshopInfo, maxInstallmentValue: 300 };
      await expect(getWebshopInfo()).resolves.toEqual(fresh);

      mockConfig('1', '300', 'other-webshop');
      getWebshopInfoMock.mockResolvedValueOnce(otherWebshop);
      await expect(getWebshopInfo()).resolves.toEqual({ data: otherWebshop, isStale: false });

      mockConfig();
      await expect(getWebshopInfo()).resolves.toEqual(fresh);
      expect(getWebshopInfoMock).toHaveBeenCalledTimes(2);
    });

    it('should not share a failed request retry window with another webshop', async () => {
      getWebshopInfoMock.mockRejectedValueOnce(new Error('Unavailable'));
      await expect(getWebshopInfo()).rejects.toThrow('Unavailable');

      mockConfig('1', '300', 'other-webshop');
      await expect(getWebshopInfo()).resolves.toEqual(fresh);

      mockConfig();
      await expect(getWebshopInfo()).rejects.toThrow('waiting for the next retry');
      expect(getWebshopInfoMock).toHaveBeenCalledTimes(2);
    });

    it('should not fall back to another webshop configuration after a failed fetch', async () => {
      await getWebshopInfo();
      mockConfig('1', '300', 'other-webshop');
      getWebshopInfoMock.mockRejectedValueOnce(new Error('Unavailable'));

      await expect(getWebshopInfo()).rejects.toThrow('Unavailable');
    });

    it('should isolate in-flight requests and use the TTL captured for each webshop', async () => {
      jest.useFakeTimers({ now: 0 });
      let resolveFirst: (value: unknown) => void = () => {};
      getWebshopInfoMock.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)));
      mockConfig('1', '1');
      const firstRequest = getWebshopInfo();

      const otherWebshop = { ...webshopInfo, maxInstallmentValue: 300 };
      mockConfig('1', '300', 'other-webshop');
      getWebshopInfoMock.mockResolvedValueOnce(otherWebshop);
      const otherRequest = getWebshopInfo();
      resolveFirst(webshopInfo);

      await expect(firstRequest).resolves.toEqual(fresh);
      await expect(otherRequest).resolves.toEqual({ data: otherWebshop, isStale: false });
      expect(getWebshopInfoMock).toHaveBeenCalledTimes(2);

      jest.setSystemTime(1001);
      mockConfig('1', '1');
      await getWebshopInfo();
      expect(getWebshopInfoMock).toHaveBeenCalledTimes(3);
      mockConfig('1', '300', 'other-webshop');
      await expect(getWebshopInfo()).resolves.toEqual({ data: otherWebshop, isStale: false });
      expect(getWebshopInfoMock).toHaveBeenCalledTimes(3);
    });

    it('should return the cached webshop info within the TTL', async () => {
      await expect(getWebshopInfo()).resolves.toEqual(fresh);
      await expect(getWebshopInfo()).resolves.toEqual(fresh);

      expect(getWebshopInfoMock).toHaveBeenCalledTimes(1);
    });

    it('should fetch the webshop info again after the TTL expired', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-07T10:00:00Z') });

      await getWebshopInfo();
      jest.setSystemTime(new Date('2026-10-07T10:04:59Z'));
      await getWebshopInfo();
      expect(getWebshopInfoMock).toHaveBeenCalledTimes(1);

      jest.setSystemTime(new Date('2026-10-07T10:05:01Z'));
      await getWebshopInfo();
      expect(getWebshopInfoMock).toHaveBeenCalledTimes(2);
    });

    it('should not cache the webshop info if the TTL is 0', async () => {
      mockConfig('1', '0');

      await getWebshopInfo();
      await getWebshopInfo();

      expect(getWebshopInfoMock).toHaveBeenCalledTimes(2);
    });

    it('should share one request between concurrent calls', async () => {
      await Promise.all([getWebshopInfo(), getWebshopInfo(), getWebshopInfo()]);

      expect(getWebshopInfoMock).toHaveBeenCalledTimes(1);
    });

    it('should wait for the retry delay before fetching again after a failed request', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-07T10:00:00Z') });
      const error = new Error('Service unavailable');
      getWebshopInfoMock.mockRejectedValueOnce(error);

      await expect(getWebshopInfo()).rejects.toThrow('Service unavailable');
      expect(log.error).toHaveBeenCalledWith('Failed to fetch easyCredit webshop info', error);

      jest.setSystemTime(new Date('2026-10-07T10:00:29Z'));
      const retryError = await getWebshopInfo().catch((error: unknown) => error);
      expect(retryError).toMatchObject({
        message: 'easyCredit webshop info is unavailable, waiting for the next retry (Service unavailable)',
        cause: error,
      });
      expect(getWebshopInfoMock).toHaveBeenCalledTimes(1);

      jest.setSystemTime(new Date('2026-10-07T10:00:31Z'));
      await expect(getWebshopInfo()).resolves.toEqual(fresh);
      expect(getWebshopInfoMock).toHaveBeenCalledTimes(2);
    });

    it('should keep serving the last known data if a refresh fails after the TTL expired', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-07T10:00:00Z') });
      await getWebshopInfo();

      const error = new Error('Service unavailable');
      getWebshopInfoMock.mockRejectedValue(error);
      jest.setSystemTime(new Date('2026-10-07T10:05:01Z'));

      await expect(getWebshopInfo()).resolves.toEqual(stale);
      expect(log.warn).toHaveBeenCalledWith(
        'Failed to refresh easyCredit webshop info, using the last known data',
        error,
      );
      expect(getWebshopInfoMock).toHaveBeenCalledTimes(2);

      jest.setSystemTime(new Date('2026-10-07T10:05:30Z'));
      await expect(getWebshopInfo()).resolves.toEqual(stale);
      expect(getWebshopInfoMock).toHaveBeenCalledTimes(2);

      jest.setSystemTime(new Date('2026-10-07T10:05:32Z'));
      await expect(getWebshopInfo()).resolves.toEqual(stale);
      expect(getWebshopInfoMock).toHaveBeenCalledTimes(3);

      getWebshopInfoMock.mockResolvedValue(webshopInfo);
      jest.setSystemTime(new Date('2026-10-07T10:06:03Z'));
      await expect(getWebshopInfo()).resolves.toEqual(fresh);
    });

    it.each([
      ['a 5xx response', new Errorx({ code: 'Bad Gateway', message: 'Bad Gateway', httpErrorStatus: 502 })],
      ['a 408 response', new Errorx({ code: 'Timeout', message: 'Timeout', httpErrorStatus: 408 })],
      ['a 429 response', new Errorx({ code: 'Too Many', message: 'Too Many', httpErrorStatus: 429 })],
      ['a timeout', new DOMException('The operation was aborted due to timeout', 'TimeoutError')],
    ])('should fall back to the last known data on %s', async (_, error) => {
      jest.useFakeTimers({ now: new Date('2026-10-07T10:00:00Z') });
      await getWebshopInfo();

      getWebshopInfoMock.mockRejectedValue(error);
      jest.setSystemTime(new Date('2026-10-07T10:05:01Z'));

      await expect(getWebshopInfo()).resolves.toEqual(stale);
    });

    it.each([
      ['a 401 response', new Errorx({ code: 'Unauthorized', message: 'Unauthorized', httpErrorStatus: 401 })],
      ['a 403 response', new Errorx({ code: 'Forbidden', message: 'Forbidden', httpErrorStatus: 403 })],
      ['a 404 response', new Errorx({ code: 'Not Found', message: 'Not Found', httpErrorStatus: 404 })],
    ])('should drop the last known data on %s', async (_, error) => {
      jest.useFakeTimers({ now: new Date('2026-10-07T10:00:00Z') });
      await getWebshopInfo();

      getWebshopInfoMock.mockRejectedValue(error);
      jest.setSystemTime(new Date('2026-10-07T10:05:01Z'));

      await expect(getWebshopInfo()).rejects.toBe(error);
      await expect(getWebshopInfo()).rejects.toThrow('waiting for the next retry');
      expect(log.warn).not.toHaveBeenCalled();
    });

    it('should drop the last known data on an invalid response', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-07T10:00:00Z') });
      await getWebshopInfo();

      getWebshopInfoMock.mockResolvedValue({ ...webshopInfo, installmentPaymentActive: 'yes' });
      jest.setSystemTime(new Date('2026-10-07T10:05:01Z'));

      await expect(getWebshopInfo()).rejects.toThrow('Invalid easyCredit webshop info');
    });

    it('should stop serving the last known data one hour after it expired', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-07T10:00:00Z') });
      await getWebshopInfo();

      const error = new Error('Service unavailable');
      getWebshopInfoMock.mockRejectedValue(error);

      jest.setSystemTime(new Date('2026-10-07T11:04:50Z'));
      await expect(getWebshopInfo()).resolves.toEqual(stale);

      // The retry window ends with the stale period instead of 30 seconds later.
      jest.setSystemTime(new Date('2026-10-07T11:05:00Z'));
      await expect(getWebshopInfo()).rejects.toBe(error);
      expect(getWebshopInfoMock).toHaveBeenCalledTimes(3);
    });

    it.each([
      ['null', null],
      ['an empty object', {}],
      ['a missing installmentPaymentActive', { ...webshopInfo, installmentPaymentActive: undefined }],
      ['a missing minInstallmentValue', { ...webshopInfo, minInstallmentValue: undefined }],
      ['a negative installment limit', { ...webshopInfo, minInstallmentValue: -1 }],
      ['a negative bill payment limit', { ...webshopInfo, minBillingValue: -1 }],
      ['inverted installment limits', { ...webshopInfo, minInstallmentValue: 500, maxInstallmentValue: 200 }],
      ['inverted bill payment limits', { ...webshopInfo, minBillingValue: 500, maxBillingValue: 200 }],
      ['a string limit', { ...webshopInfo, minInstallmentValue: '200' }],
      ['a null limit', { ...webshopInfo, maxInstallmentValue: null }],
      ['a string bill payment flag', { ...webshopInfo, billPaymentActive: 'true' }],
    ])('should reject a webshop info with %s', async (_, body) => {
      getWebshopInfoMock.mockResolvedValue(body);

      await expect(getWebshopInfo()).rejects.toThrow('Invalid easyCredit webshop info');
      await expect(getWebshopInfo()).rejects.toThrow('waiting for the next retry');
      expect(getWebshopInfoMock).toHaveBeenCalledTimes(1);
    });

    it('should accept a webshop info without bill payment fields', async () => {
      const { availability, installmentPaymentActive, minInstallmentValue, maxInstallmentValue } = webshopInfo;
      const installmentOnly = { availability, installmentPaymentActive, minInstallmentValue, maxInstallmentValue };
      getWebshopInfoMock.mockResolvedValue(installmentOnly);

      await expect(getWebshopInfo()).resolves.toEqual({ data: installmentOnly, isStale: false });
    });

    it('should assume the webshop is available if easyCredit does not return availability', async () => {
      getWebshopInfoMock.mockResolvedValue({ ...webshopInfo, availability: undefined });

      await expect(getWebshopInfo()).resolves.toEqual(fresh);
      expect(log.warn).toHaveBeenCalledWith(
        'easyCredit webshop info has no availability, assuming the webshop is available',
      );
    });

    it('should not cache a request that was in flight during a reset', async () => {
      let resolveStaleRequest: ((value: unknown) => void) | undefined;
      getWebshopInfoMock.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveStaleRequest = resolve;
        }),
      );

      const staleRequest = getWebshopInfo();
      resetWebshopInfoCache();
      resolveStaleRequest?.({ ...webshopInfo, maxInstallmentValue: 300 });
      await staleRequest;

      await expect(getWebshopInfo()).resolves.toEqual(fresh);
      expect(getWebshopInfoMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('getPaymentTypesAvailability', () => {
    it('should offer both payment types with the limits from the webshop info', async () => {
      await expect(getPaymentTypesAvailability(500)).resolves.toEqual({
        INSTALLMENT_PAYMENT: { enabled: true, available: true, minAmount: 200, maxAmount: 10000 },
        BILL_PAYMENT: { enabled: true, available: true, minAmount: 50, maxAmount: 5000 },
      });
    });

    it('should keep the payment types enabled if the amount is out of range', async () => {
      await expect(getPaymentTypesAvailability(10)).resolves.toEqual({
        INSTALLMENT_PAYMENT: { enabled: true, available: false, minAmount: 200, maxAmount: 10000 },
        BILL_PAYMENT: { enabled: true, available: false, minAmount: 50, maxAmount: 5000 },
      });
    });

    it.each([
      [49.99, false],
      [50, true],
      [5000, true],
      [5000.01, false],
    ])('should check bill payment limits for amount %s', async (amount, available) => {
      const result = await getPaymentTypesAvailability(amount);

      expect(result.BILL_PAYMENT.available).toBe(available);
    });

    it.each([
      [199.99, false],
      [200, true],
      [10000, true],
      [10000.01, false],
    ])('should check installment limits for amount %s', async (amount, available) => {
      const result = await getPaymentTypesAvailability(amount);

      expect(result.INSTALLMENT_PAYMENT.available).toBe(available);
    });

    it('should not offer bill payment if the merchant toggle is off', async () => {
      mockConfig('0');

      const result = await getPaymentTypesAvailability(500);

      expect(result.BILL_PAYMENT).toEqual({ enabled: false, available: false, minAmount: 50, maxAmount: 5000 });
      expect(result.INSTALLMENT_PAYMENT.available).toBe(true);
    });

    it('should not offer bill payment if it is not activated for the webshop', async () => {
      getWebshopInfoMock.mockResolvedValue({ ...webshopInfo, billPaymentActive: false });

      const result = await getPaymentTypesAvailability(500);

      expect(result.BILL_PAYMENT).toEqual(expect.objectContaining({ enabled: false, available: false }));
      expect(result.INSTALLMENT_PAYMENT.available).toBe(true);
    });

    it('should not offer installment if it is not activated for the webshop', async () => {
      getWebshopInfoMock.mockResolvedValue({ ...webshopInfo, installmentPaymentActive: false });

      const result = await getPaymentTypesAvailability(500);

      expect(result.INSTALLMENT_PAYMENT).toEqual(expect.objectContaining({ enabled: false, available: false }));
      expect(result.BILL_PAYMENT.available).toBe(true);
    });

    it('should offer no payment type if the webshop is not available', async () => {
      getWebshopInfoMock.mockResolvedValue({ ...webshopInfo, availability: false });

      await expect(getPaymentTypesAvailability(500)).resolves.toEqual({
        INSTALLMENT_PAYMENT: { enabled: false, available: false, minAmount: 200, maxAmount: 10000 },
        BILL_PAYMENT: { enabled: false, available: false, minAmount: 50, maxAmount: 5000 },
      });
    });

    it.each([
      ['billPaymentActive', { ...webshopInfo, billPaymentActive: undefined }],
      ['minBillingValue', { ...webshopInfo, minBillingValue: undefined }],
      ['maxBillingValue', { ...webshopInfo, maxBillingValue: undefined }],
    ])('should not offer bill payment if %s is missing', async (_, body) => {
      getWebshopInfoMock.mockResolvedValue(body);

      const result = await getPaymentTypesAvailability(500);

      expect(result.BILL_PAYMENT).toEqual(expect.objectContaining({ enabled: false, available: false }));
      expect(result.INSTALLMENT_PAYMENT.available).toBe(true);
    });

    it('should not offer bill payment while serving stale data', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-07T10:00:00Z') });
      await getPaymentTypesAvailability(500);

      getWebshopInfoMock.mockRejectedValue(new Error('Service unavailable'));
      jest.setSystemTime(new Date('2026-10-07T10:05:01Z'));

      const result = await getPaymentTypesAvailability(500);

      expect(result.BILL_PAYMENT).toEqual({ enabled: false, available: false, minAmount: 50, maxAmount: 5000 });
      expect(result.INSTALLMENT_PAYMENT.available).toBe(true);
    });

    it('should throw an EasyCreditUnavailable error if the webshop info cannot be fetched', async () => {
      getWebshopInfoMock.mockRejectedValue(new Error('Service unavailable'));

      const error = await getPaymentTypesAvailability(500).catch((error: unknown) => error);

      expect(error).toBeInstanceOf(Errorx);
      expect(error).toMatchObject({
        code: 'EasyCreditUnavailable',
        httpErrorStatus: 503,
        fields: { webShopId: 'webShopId123' },
      });
    });
  });
});
