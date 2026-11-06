import { healthCheck, isWidgetEnabled, WIDGET_PAYMENT_TYPES_TIMEOUT_MS } from '../../src/services/connector.service';
import { log } from '../../src/libs/logger';
import { initEasyCreditClient } from '../../src/client/easycredit.client';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { readConfiguration } from '../../src/utils/config.utils';
import { getPaymentTypesAvailability } from '../../src/services/webshop.service';
import { Errorx } from '@commercetools/connect-payments-sdk';

// Mock dependencies
jest.mock('../../src/libs/logger', () => ({
  log: {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('../../src/services/webshop.service', () => ({
  getPaymentTypesAvailability: jest.fn(),
}));

const availability = (installment: boolean, bill: boolean) => ({
  INSTALLMENT_PAYMENT: { enabled: installment, available: installment },
  BILL_PAYMENT: { enabled: bill, available: bill },
});

jest.mock('../../src/utils/config.utils', () => ({
  readConfiguration: jest.fn().mockReturnValue({
    easyCredit: {
      widgetEnabled: '1',
      webShopId: 'mock-webshop-id',
    },
  }),
}));

jest.mock('../../src/client/easycredit.client', () => ({
  initEasyCreditClient: jest.fn().mockReturnValue({
    integrationCheck: jest.fn(),
  }),
}));

describe('Health Check and Widget Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks(); // Clear previous mocks
  });

  describe('healthCheck', () => {
    it('should log debug message and call integrationCheck', async () => {
      const integrationCheckMock = initEasyCreditClient().integrationCheck as jest.Mock;

      await healthCheck();

      expect(log.debug).toHaveBeenCalledWith('healthCheck - The connector is running healthily.');
      expect(integrationCheckMock).toHaveBeenCalledWith({ message: 'ratenkauf by easyCredit' });
    });

    it('should log an error and throw when integrationCheck fails', async () => {
      const integrationCheckMock = initEasyCreditClient().integrationCheck as jest.Mock;
      const errorMessage = new Error('Integration check failed');

      // @ts-expect-error mocked
      integrationCheckMock.mockRejectedValueOnce(errorMessage);

      await expect(healthCheck()).rejects.toThrow(errorMessage);
      expect(log.error).toHaveBeenCalledWith(
        'healthCheck - Unexpected error occurred when processing request',
        errorMessage,
      );
    });
  });

  describe('isWidgetEnabled', () => {
    beforeEach(() => {
      (getPaymentTypesAvailability as jest.Mock).mockResolvedValue(availability(true, false) as never);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should return widget enabled status and webShopId', async () => {
      const result = await isWidgetEnabled();

      expect(log.debug).toHaveBeenCalledWith('get Widget config');
      expect(result).toEqual({
        isEnabled: true,
        webShopId: 'mock-webshop-id',
        paymentTypes: ['INSTALLMENT_PAYMENT'],
      });
    });

    it('should advertise bill payment when checkout offers it', async () => {
      (getPaymentTypesAvailability as jest.Mock).mockResolvedValue(availability(true, true) as never);

      expect((await isWidgetEnabled()).paymentTypes).toEqual(['INSTALLMENT_PAYMENT', 'BILL_PAYMENT']);
    });

    it('should advertise only bill payment when installment is not active', async () => {
      (getPaymentTypesAvailability as jest.Mock).mockResolvedValue(availability(false, true) as never);

      expect((await isWidgetEnabled()).paymentTypes).toEqual(['BILL_PAYMENT']);
    });

    it('should advertise nothing when checkout offers no payment type', async () => {
      (getPaymentTypesAvailability as jest.Mock).mockResolvedValue(availability(false, false) as never);

      expect((await isWidgetEnabled()).paymentTypes).toEqual([]);
    });

    it('should ask the webshop service quietly, as the widget runs on every page', async () => {
      await isWidgetEnabled();

      expect(getPaymentTypesAvailability).toHaveBeenCalledWith(0, { quiet: true });
    });

    it('should advertise nothing when the webshop config is unavailable', async () => {
      (getPaymentTypesAvailability as jest.Mock).mockRejectedValue(new Error('easyCredit down') as never);

      expect((await isWidgetEnabled()).paymentTypes).toEqual([]);
      // Debug only: this runs on every widget mount.
      expect(log.warn).not.toHaveBeenCalled();
    });

    it('should advertise nothing when easyCredit is reported unavailable (503), as checkout refuses it', async () => {
      (getPaymentTypesAvailability as jest.Mock).mockRejectedValue(
        new Errorx({ code: 'EasyCreditUnavailable', httpErrorStatus: 503, message: 'down' }) as never,
      );

      expect((await isWidgetEnabled()).paymentTypes).toEqual([]);
    });

    it('should advertise nothing if the webshop config takes longer than the widget timeout', async () => {
      jest.useFakeTimers();
      // The lookup never settles before the timeout, like a hanging easyCredit request.
      (getPaymentTypesAvailability as jest.Mock).mockReturnValue(new Promise(() => undefined) as never);

      const result = isWidgetEnabled();
      await jest.advanceTimersByTimeAsync(WIDGET_PAYMENT_TYPES_TIMEOUT_MS);

      expect((await result).paymentTypes).toEqual([]);
    });

    it('should not ask easyCredit when the widget is disabled', async () => {
      (readConfiguration as jest.Mock).mockReturnValueOnce({
        easyCredit: { widgetEnabled: '0', webShopId: 'mock-webshop-id' },
      });

      expect((await isWidgetEnabled()).paymentTypes).toEqual([]);
      expect(getPaymentTypesAvailability).not.toHaveBeenCalled();
    });

    it('should return widget enabled status (false) and webShopId', async () => {
      (readConfiguration as jest.Mock).mockReturnValue({
        easyCredit: {
          widgetEnabled: '0',
          webShopId: 'mock-webshop-id',
        },
      });

      const result = await isWidgetEnabled();

      expect(log.debug).toHaveBeenCalledWith('get Widget config');
      expect(result).toEqual({
        isEnabled: false,
        webShopId: 'mock-webshop-id',
        paymentTypes: [],
      });
    });
  });
});
