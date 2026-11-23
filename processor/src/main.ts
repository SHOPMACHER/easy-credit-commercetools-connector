import 'dotenv/config';

import { readConfiguration } from './utils/config.utils';

import { setupFastify } from './server/server';
import { log } from './libs/logger';

// Read env variables
const { installmentPaymentEnabled, billPaymentEnabled } = readConfiguration().easyCredit;

if (installmentPaymentEnabled === '0' && billPaymentEnabled === '0') {
  log.warn('Installment and bill payment are both disabled, the connector offers no easyCredit payment method');
}

(async () => {
  const server = await setupFastify();

  const HOST = '0.0.0.0';
  try {
    await server.listen({
      port: 8080,
      host: HOST,
    });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
})();
