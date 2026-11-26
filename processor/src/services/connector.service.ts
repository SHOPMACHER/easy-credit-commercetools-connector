import { log } from '../libs/logger';
import { getPaymentTypeConfig, readConfiguration } from '../utils/config.utils';
import { initEasyCreditClient } from '../client/easycredit.client';
import { getPaymentTypesAvailability } from './webshop.service';
import { ECTransactionPaymentType } from '../types/payment.types';
import {
  getPaymentTypesExcludingProductType,
  getPaymentTypesWithProductTypeExclusions,
} from './paymentTypeRestriction.service';
import { WidgetEnabledResponseSchemaDTO } from '../dtos/operations/widgetEnabled.dto';

// Settings that don't stop the connector but likely aren't what the merchant meant; logged once at startup.
export const logConfigurationWarnings = (): void => {
  const { easyCredit } = readConfiguration();

  if (easyCredit.installmentPaymentEnabled === '0' && easyCredit.billPaymentEnabled === '0') {
    log.warn('Installment and bill payment are both disabled, the connector offers no easyCredit payment method');
  }

  for (const paymentType of Object.values(ECTransactionPaymentType)) {
    if (getPaymentTypeConfig(easyCredit, paymentType).invalidAmountLimits) {
      log.warn(`Invalid ${paymentType}_MIN_AMOUNT or ${paymentType}_MAX_AMOUNT, using the easyCredit limits`);
    }
  }
};

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

export const isWidgetEnabled = async (productTypeId?: string): Promise<WidgetEnabledResponseSchemaDTO> => {
  const config = readConfiguration();

  log.debug('get Widget config');

  const isEnabled = config.easyCredit.widgetEnabled === '1';
  const expressButtonEnabled = config.easyCredit.expressButtonEnabled === '1';
  const checksProductType =
    Boolean(productTypeId) && expressButtonEnabled && config.easyCredit.expressButtonVisibility !== 'CART';
  const productTypeToCheck = checksProductType ? productTypeId : undefined;

  return {
    isEnabled,
    webShopId: config.easyCredit.webShopId,
    // Neither the widget nor the express button is rendered when both are off, so there is no reason to ask easyCredit.
    ...(isEnabled || expressButtonEnabled ? await getWidgetPaymentTypes(productTypeToCheck) : { paymentTypes: [] }),
    expressButtonEnabled,
    expressButtonVisibility: config.easyCredit.expressButtonVisibility,
  };
};

// The widget is shown on every product and cart page, so it never waits long for easyCredit's webshop config.
// A slow lookup keeps running and fills the cache for the next request.
export const WIDGET_PAYMENT_TYPES_TIMEOUT_MS = 1500;

// The widget advertises a payment type only when checkout offers it, with the same rules (both types fail closed).
// An empty list means checkout offers nothing, so the assets render no widget.
// easyCredit's limits are left to the widget, so only the limits the merchant narrowed are sent along.
// With a productTypeId (only passed for the PDP express button) the types that exclude that product type are dropped as well.
const getWidgetPaymentTypes = async (productTypeId?: string): Promise<WidgetPaymentTypes> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), WIDGET_PAYMENT_TYPES_TIMEOUT_MS);
  });

  try {
    const lookup = getPaymentTypesAvailability(0);
    // If the timeout wins, a later rejection of the lookup must not become an unhandled rejection.
    lookup.catch(() => undefined);

    // Started here so it runs in parallel with the easyCredit lookup; the catch covers the lookup rejecting.
    const excludingLookup = productTypeId
      ? getPaymentTypesExcludingProductType(productTypeId).catch(() => undefined)
      : undefined;
    const availability = await Promise.race([lookup, timeout]);

    if (availability === 'timeout') {
      // Not known to be offered yet, and a switched-off installment must not be advertised either.
      log.debug('get Widget payment types timed out, hiding the widget');
      return { paymentTypes: [] };
    }

    // A product type lookup that is slow or failed counts as excluded for every type that has exclusions.
    let excluded: ECTransactionPaymentType[] = [];
    if (excludingLookup) {
      const excludingResult = await Promise.race([excludingLookup, timeout]);
      excluded =
        excludingResult && excludingResult !== 'timeout' ? excludingResult : getPaymentTypesWithProductTypeExclusions();
    }
    const paymentTypes = [
      ECTransactionPaymentType.ECTransactionInstallmentPayment,
      ECTransactionPaymentType.ECTransactionBillPayment,
    ].filter((paymentType) => availability[paymentType].enabled && !excluded.includes(paymentType));
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
