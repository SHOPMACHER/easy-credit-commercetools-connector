import { healthCheck, isWidgetEnabled } from '../../src/services/connector.service';
import { log } from '../../src/libs/logger';
import { initEasyCreditClient } from '../../src/client/easycredit.client';

// Mock dependencies
jest.mock('../../src/libs/logger', () => ({
  log: {
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../src/utils/config.utils', () => ({
  readConfiguration: jest.fn().mockReturnValue({
    easyCredit: {
      widgetEnabled: true,
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
      integrationCheckMock.mockRejectedValueOnce(errorMessage);

      await expect(healthCheck()).rejects.toThrow(errorMessage);
      expect(log.error).toHaveBeenCalledWith(
        'healthCheck - Unexpected error occurred when processing request',
        errorMessage,
      );
    });
  });

  describe('isWidgetEnabled', () => {
    it('should return widget enabled status and webShopId', async () => {
      const result = await isWidgetEnabled();

      expect(log.debug).toHaveBeenCalledWith('get Widget config');
      expect(result).toEqual({
        isEnabled: true,
        webShopId: 'mock-webshop-id',
      });
    });
  });
});
