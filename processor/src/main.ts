import 'dotenv/config';

import { getPaymentTypeConfig, readConfiguration } from './utils/config.utils';
import { ECTransactionPaymentType } from './types/payment.types';

import { setupFastify } from './server/server';
import { log } from './libs/logger';

// Read env variables
const { easyCredit } = readConfiguration();
const { installmentPaymentEnabled, billPaymentEnabled } = easyCredit;

if (installmentPaymentEnabled === '0' && billPaymentEnabled === '0') {
  log.warn('Installment and bill payment are both disabled, the connector offers no easyCredit payment method');
}

for (const paymentType of Object.values(ECTransactionPaymentType)) {
  if (getPaymentTypeConfig(easyCredit, paymentType).invalidAmountLimits) {
    log.warn(`Invalid ${paymentType}_MIN_AMOUNT or ${paymentType}_MAX_AMOUNT, using the easyCredit limits`);
  }
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
