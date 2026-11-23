import { log } from '../libs/logger';
import { readConfiguration } from '../utils/config.utils';
import { initEasyCreditClient } from '../client/easycredit.client';
import { getPaymentTypesAvailability } from './webshop.service';
import { ECTransactionPaymentType } from '../types/payment.types';
import { WidgetEnabledResponseSchemaDTO } from '../dtos/operations/widgetEnabled.dto';

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

type WidgetPaymentTypes = Pick<WidgetEnabledResponseSchemaDTO, 'paymentTypes' | 'amountLimits'>;

export const isWidgetEnabled = async (): Promise<WidgetEnabledResponseSchemaDTO> => {
  const config = readConfiguration();

  log.debug('get Widget config');

  const isEnabled = config.easyCredit.widgetEnabled === '1';

  return {
    isEnabled,
    webShopId: config.easyCredit.webShopId,
    // A disabled widget is not rendered, so there is no reason to ask easyCredit.
    ...(isEnabled ? await getWidgetPaymentTypes() : { paymentTypes: [] }),
  };
};

// The widget is shown on every product and cart page, so it never waits long for easyCredit's webshop config.
// A slow lookup keeps running and fills the cache for the next request.
export const WIDGET_PAYMENT_TYPES_TIMEOUT_MS = 1500;

// The widget advertises a payment type only when checkout offers it, with the same rules (both types fail closed).
// An empty list means checkout offers nothing, so the assets render no widget.
// easyCredit's limits are left to the widget, so only the limits the merchant narrowed are sent along.
const getWidgetPaymentTypes = async (): Promise<WidgetPaymentTypes> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), WIDGET_PAYMENT_TYPES_TIMEOUT_MS);
  });

  try {
    const lookup = getPaymentTypesAvailability(0);
    // If the timeout wins, a later rejection of the lookup must not become an unhandled rejection.
    lookup.catch(() => undefined);
    const availability = await Promise.race([lookup, timeout]);

    if (availability === 'timeout') {
      // Not known to be offered yet, and a switched-off installment must not be advertised either.
      log.debug('get Widget payment types timed out, hiding the widget');
      return { paymentTypes: [] };
    }

    const paymentTypes = [
      ECTransactionPaymentType.ECTransactionInstallmentPayment,
      ECTransactionPaymentType.ECTransactionBillPayment,
    ].filter((paymentType) => availability[paymentType].enabled);
    const amountLimits: NonNullable<WidgetPaymentTypes['amountLimits']> = {};

    for (const paymentType of paymentTypes) {
      const { merchantLimited, minAmount, maxAmount } = availability[paymentType];
      if (merchantLimited && minAmount !== undefined && maxAmount !== undefined) {
        amountLimits[paymentType] = { minAmount, maxAmount };
      }
    }

    return Object.keys(amountLimits).length > 0 ? { paymentTypes, amountLimits } : { paymentTypes };
  } catch (error) {
    // Checkout refuses what it can't check, so the widget doesn't advertise it either. Debug only: runs on every mount.
    log.debug('get Widget payment types failed, hiding the widget', error);
    return { paymentTypes: [] };
  } finally {
    clearTimeout(timer);
  }
};
