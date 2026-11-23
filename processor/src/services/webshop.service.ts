import { Errorx } from '@commercetools/connect-payments-sdk';
import { Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { initEasyCreditClient } from '../client/easycredit.client';
import { log } from '../libs/logger';
import { ECTransactionPaymentType, ECWebshopInfo, PaymentTypesAvailability } from '../types/payment.types';
import { getPaymentTypeConfig, readConfiguration } from '../utils/config.utils';
import { EASYCREDIT_WEBSHOP_INFO_RETRY_MS } from '../utils/constant.utils';

const Limit = Type.Number({ minimum: 0 });

const ECWebshopInfoSchema = Type.Object({
  // Remain compatible with merchants whose webshop response omits this field.
  availability: Type.Optional(Type.Boolean()),
  installmentPaymentActive: Type.Boolean(),
  minInstallmentValue: Limit,
  maxInstallmentValue: Limit,
});

// Validated separately, so invalid bill fields only disable bill payment and never installment.
const ECBillInfoSchema = Type.Object({
  billPaymentActive: Type.Boolean(),
  minBillingValue: Limit,
  maxBillingValue: Limit,
});

// Holds either a valid response or the error of the last request until `expiresAt`.
type CachedWebshopInfo = { expiresAt: number } & ({ data: ECWebshopInfo } | { error: unknown });

class InvalidWebshopInfoError extends Error {}

class WebshopInfoRetryError extends Error {}

const cachedWebshopInfoById = new Map<string, CachedWebshopInfo>();
const pendingWebshopInfoById = new Map<string, Promise<ECWebshopInfo>>();
// Lets a reset discard the result of a request that was in flight before it.
let cacheGeneration = 0;

export const resetWebshopInfoCache = (): void => {
  cachedWebshopInfoById.clear();
  pendingWebshopInfoById.clear();
  cacheGeneration += 1;
};

const hasInvertedLimits = (minAmount?: number, maxAmount?: number): boolean =>
  minAmount !== undefined && maxAmount !== undefined && minAmount > maxAmount;

const parseBillInfo = ({
  billPaymentActive,
  minBillingValue,
  maxBillingValue,
}: Record<string, unknown>): Partial<Static<typeof ECBillInfoSchema>> => {
  const bill = { billPaymentActive, minBillingValue, maxBillingValue };

  if (Value.Check(ECBillInfoSchema, bill) && !hasInvertedLimits(bill.minBillingValue, bill.maxBillingValue)) {
    return bill;
  }

  // Webshops without bill payment may send no or null bill fields, which is not worth a warning.
  if (billPaymentActive !== false && Object.values(bill).some((value) => value !== undefined && value !== null)) {
    log.warn('Invalid easyCredit bill payment config, bill payment is not offered', bill);
  }

  return {};
};

const parseWebshopInfo = (data: unknown): ECWebshopInfo => {
  if (!Value.Check(ECWebshopInfoSchema, data)) {
    const details = [...Value.Errors(ECWebshopInfoSchema, data)].map(({ path, message }) => `${path}: ${message}`);

    throw new InvalidWebshopInfoError(`Invalid easyCredit webshop info (${details.join(', ')})`);
  }

  const { availability, installmentPaymentActive, minInstallmentValue, maxInstallmentValue } = data;

  if (hasInvertedLimits(minInstallmentValue, maxInstallmentValue)) {
    throw new InvalidWebshopInfoError('Invalid easyCredit webshop info (a minimum limit exceeds its maximum limit)');
  }

  if (availability === undefined) {
    log.warn('easyCredit webshop info has no availability, assuming the webshop is available');
  }

  return {
    availability: availability ?? true,
    installmentPaymentActive,
    minInstallmentValue,
    maxInstallmentValue,
    ...parseBillInfo(data),
  };
};

const getErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const fetchWebshopInfo = async (webShopId: string, cacheTtlSeconds: number): Promise<ECWebshopInfo> => {
  const generation = cacheGeneration;

  const cache = (entry: CachedWebshopInfo) => {
    if (generation === cacheGeneration) {
      cachedWebshopInfoById.set(webShopId, entry);
    }
  };

  try {
    const data = parseWebshopInfo(await initEasyCreditClient().getWebshopInfo());
    cache({ data, expiresAt: Date.now() + cacheTtlSeconds * 1000 });

    return data;
  } catch (error: unknown) {
    // Wait before retrying so an outage does not make every checkout wait for the request timeout.
    cache({ error, expiresAt: Date.now() + EASYCREDIT_WEBSHOP_INFO_RETRY_MS });
    log.error('Failed to fetch easyCredit webshop info, no easyCredit payment method is offered', error);
    throw error;
  }
};

const requestWebshopInfo = (webShopId: string, cacheTtlSeconds: number): Promise<ECWebshopInfo> => {
  const pendingWebshopInfo = pendingWebshopInfoById.get(webShopId);
  if (pendingWebshopInfo) {
    return pendingWebshopInfo;
  }

  const request = fetchWebshopInfo(webShopId, cacheTtlSeconds).finally(() => {
    if (pendingWebshopInfoById.get(webShopId) === request) {
      pendingWebshopInfoById.delete(webShopId);
    }
  });
  pendingWebshopInfoById.set(webShopId, request);

  return request;
};

export const getWebshopInfo = async (): Promise<ECWebshopInfo> => {
  const { webShopId, webshopCacheTtl } = readConfiguration().easyCredit;
  const cachedWebshopInfo = cachedWebshopInfoById.get(webShopId);
  const isExpired = !cachedWebshopInfo || cachedWebshopInfo.expiresAt <= Date.now();

  if (cachedWebshopInfo && 'error' in cachedWebshopInfo) {
    // During an outage only a background request retries easyCredit, so no checkout waits for the timeout.
    if (isExpired) {
      requestWebshopInfo(webShopId, Number(webshopCacheTtl)).catch(() => undefined);
    }

    throw new WebshopInfoRetryError(
      `easyCredit webshop info is unavailable, waiting for the next retry (${getErrorMessage(cachedWebshopInfo.error)})`,
      { cause: cachedWebshopInfo.error },
    );
  }

  if (cachedWebshopInfo && !isExpired) {
    return cachedWebshopInfo.data;
  }

  return requestWebshopInfo(webShopId, Number(webshopCacheTtl));
};

const getRetryAfterSeconds = (webShopId: string): number => {
  const expiresAt = cachedWebshopInfoById.get(webShopId)?.expiresAt ?? Date.now() + EASYCREDIT_WEBSHOP_INFO_RETRY_MS;

  return Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
};

const easyCreditUnavailableError = (webShopId: string, cause?: unknown): Errorx =>
  new Errorx({
    code: 'EasyCreditUnavailable',
    httpErrorStatus: 503,
    message: 'easyCredit ist derzeit nicht erreichbar. Bitte versuchen Sie es später erneut.',
    // The enabler needs the webShopId to render the widget with the alert.
    fields: { webShopId },
    privateFields: { retryAfterSeconds: getRetryAfterSeconds(webShopId) },
    cause,
  });

const isWithinLimits = (amount: number, minAmount: number, maxAmount: number): boolean =>
  amount >= minAmount && amount <= maxAmount;

// Fails closed for every payment type: without a valid easyCredit response nothing is offered.
export const getPaymentTypesAvailability = async (amount: number): Promise<PaymentTypesAvailability> => {
  const { easyCredit } = readConfiguration();
  const { webShopId } = easyCredit;
  let webshopInfo: ECWebshopInfo;

  try {
    webshopInfo = await getWebshopInfo();
  } catch (error: unknown) {
    throw easyCreditUnavailableError(webShopId, error);
  }

  const {
    availability,
    installmentPaymentActive,
    minInstallmentValue,
    maxInstallmentValue,
    billPaymentActive,
    minBillingValue,
    maxBillingValue,
  } = webshopInfo;

  const isInstallmentEnabled =
    getPaymentTypeConfig(easyCredit, ECTransactionPaymentType.ECTransactionInstallmentPayment).enabled &&
    availability &&
    installmentPaymentActive;
  const isBillEnabled =
    availability &&
    getPaymentTypeConfig(easyCredit, ECTransactionPaymentType.ECTransactionBillPayment).enabled &&
    billPaymentActive === true &&
    minBillingValue !== undefined &&
    maxBillingValue !== undefined;

  return {
    [ECTransactionPaymentType.ECTransactionInstallmentPayment]: {
      enabled: isInstallmentEnabled,
      available: isInstallmentEnabled && isWithinLimits(amount, minInstallmentValue, maxInstallmentValue),
      minAmount: minInstallmentValue,
      maxAmount: maxInstallmentValue,
    },
    [ECTransactionPaymentType.ECTransactionBillPayment]: {
      enabled: isBillEnabled,
      available: isBillEnabled && isWithinLimits(amount, minBillingValue, maxBillingValue),
      minAmount: minBillingValue,
      maxAmount: maxBillingValue,
    },
  };
};
