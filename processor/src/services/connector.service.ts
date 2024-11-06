import { log } from '../libs/logger';
import { readConfiguration } from '../utils/config.utils';
import { initEasyCreditClient } from '../client/easycredit.client';

export const healthCheck = async () => {
  try {
    log.debug('healthCheck - The connector is running healthily.');

    await initEasyCreditClient().integrationCheck({
      message: 'ratenkauf by easyCredit',
    });
  } catch (error) {
    log.error('healthCheck - Unexpected error occurred when processing request', error);

    throw error;
  }
};

export const isWidgetEnabled = async () => {
  const config = readConfiguration();

  log.debug('get Widget config');

  return {
    isEnabled: config.easyCredit.widgetEnabled === '1',
    webShopId: config.easyCredit.webShopId,
  };
};
