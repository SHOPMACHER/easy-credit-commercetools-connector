import { Errorx } from '@commercetools/connect-payments-sdk';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { isNativeError } from 'node:util/types';
import { initEasyCreditClient } from '../client/easycredit.client';
import { log } from '../libs/logger';
import { ECTransactionPaymentType, ECWebshopInfo, PaymentTypesAvailability } from '../types/payment.types';
import { readConfiguration } from '../utils/config.utils';
import { EASYCREDIT_WEBSHOP_INFO_MAX_STALE_MS, EASYCREDIT_WEBSHOP_INFO_RETRY_MS } from '../utils/constant.utils';

const Limit = Type.Number({ minimum: 0 });

// Bill payment fields are optional so a webshop without bill payment does not break installment.
const ECWebshopInfoSchema = Type.Object({
  // Remain compatible with merchants whose webshop response omits this field.
  availability: Type.Optional(Type.Boolean()),
  installmentPaymentActive: Type.Boolean(),
  minInstallmentValue: Limit,
  maxInstallmentValue: Limit,
  billPaymentActive: Type.Optional(Type.Boolean()),
  minBillingValue: Type.Optional(Limit),
  maxBillingValue: Type.Optional(Limit),
});

export type WebshopInfoResult = {
  data: ECWebshopInfo;
  // Set while failed refreshes fall back to the last valid response.
  isStale: boolean;
};

type CachedWebshopInfo = {
  data?: ECWebshopInfo;
  isStale: boolean;
  expiresAt: number;
  // After this, failed refreshes no longer fall back to `data`.
  staleUntil: number;
  error?: unknown;
};

class InvalidWebshopInfoError extends Error {}

const cachedWebshopInfoById = new Map<string, CachedWebshopInfo>();
const pendingWebshopInfoById = new Map<string, Promise<WebshopInfoResult>>();
// Lets a reset discard the result of a request that was in flight before it.
let cacheGeneration = 0;

export const resetWebshopInfoCache = (): void => {
  cachedWebshopInfoById.clear();
  pendingWebshopInfoById.clear();
  cacheGeneration += 1;
};

const hasInvertedLimits = (minAmount?: number, maxAmount?: number): boolean =>
  minAmount !== undefined && maxAmount !== undefined && minAmount > maxAmount;

const parseWebshopInfo = (data: unknown): ECWebshopInfo => {
  if (!Value.Check(ECWebshopInfoSchema, data)) {
    const details = [...Value.Errors(ECWebshopInfoSchema, data)].map(({ path, message }) => `${path}: ${message}`);

    throw new InvalidWebshopInfoError(`Invalid easyCredit webshop info (${details.join(', ')})`);
  }

  if (
    hasInvertedLimits(data.minInstallmentValue, data.maxInstallmentValue) ||
    hasInvertedLimits(data.minBillingValue, data.maxBillingValue)
  ) {
    throw new InvalidWebshopInfoError('Invalid easyCredit webshop info (a minimum limit exceeds its maximum limit)');
  }

  if (data.availability === undefined) {
    log.warn('easyCredit webshop info has no availability, assuming the webshop is available');
  }

  return { ...data, availability: data.availability ?? true };
};

// Other 4xx and invalid responses mean easyCredit changed the webshop config, so stale data must not hide them.
const isTransientError = (error: unknown): boolean => {
  // Native fetch errors can come from another realm, so instanceof SyntaxError is not sufficient.
  if (error instanceof InvalidWebshopInfoError || (isNativeError(error) && error.name === 'SyntaxError')) {
    return false;
  }

  if (error instanceof Errorx) {
    const status = error.httpErrorStatus;

    return status >= 500 || status === 408 || status === 429;
  }

  return true;
};

const getErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const fetchWebshopInfo = async (webShopId: string, cacheTtlSeconds: number): Promise<WebshopInfoResult> => {
  const generation = cacheGeneration;
  const previous = cachedWebshopInfoById.get(webShopId);

  const cache = (entry: CachedWebshopInfo) => {
    if (generation === cacheGeneration) {
      cachedWebshopInfoById.set(webShopId, entry);
    }
  };

  try {
    const data = parseWebshopInfo(await initEasyCreditClient().getWebshopInfo());
    const expiresAt = Date.now() + cacheTtlSeconds * 1000;
    cache({ data, isStale: false, expiresAt, staleUntil: expiresAt + EASYCREDIT_WEBSHOP_INFO_MAX_STALE_MS });

    return { data, isStale: false };
  } catch (error: unknown) {
    const now = Date.now();
    // Wait before retrying so an outage does not make every checkout wait for the request timeout.
    const retryAt = now + EASYCREDIT_WEBSHOP_INFO_RETRY_MS;

    if (previous?.data && now < previous.staleUntil && isTransientError(error)) {
      cache({ ...previous, isStale: true, expiresAt: Math.min(retryAt, previous.staleUntil), error });
      log.warn('Failed to refresh easyCredit webshop info, using the last known data', error);

      return { data: previous.data, isStale: true };
    }

    cache({ isStale: false, expiresAt: retryAt, staleUntil: 0, error });
    log.error('Failed to fetch easyCredit webshop info', error);
    throw error;
  }
};

export const getWebshopInfo = async (): Promise<WebshopInfoResult> => {
  const { webShopId, webshopCacheTtl } = readConfiguration().easyCredit;
  const cachedWebshopInfo = cachedWebshopInfoById.get(webShopId);
  if (cachedWebshopInfo && cachedWebshopInfo.expiresAt > Date.now()) {
    const { data, isStale, error } = cachedWebshopInfo;

    if (data) {
      return { data, isStale };
    }

    throw new Error(`easyCredit webshop info is unavailable, waiting for the next retry (${getErrorMessage(error)})`, {
      cause: error,
    });
  }

  let pendingWebshopInfo = pendingWebshopInfoById.get(webShopId);
  if (!pendingWebshopInfo) {
    const request = fetchWebshopInfo(webShopId, Number(webshopCacheTtl)).finally(() => {
      if (pendingWebshopInfoById.get(webShopId) === request) {
        pendingWebshopInfoById.delete(webShopId);
      }
    });
    pendingWebshopInfoById.set(webShopId, request);
    pendingWebshopInfo = request;
  }

  return pendingWebshopInfo;
};

const isWithinLimits = (amount: number, minAmount: number, maxAmount: number): boolean =>
  amount >= minAmount && amount <= maxAmount;

export const getPaymentTypesAvailability = async (amount: number): Promise<PaymentTypesAvailability> => {
  const { webShopId, billPaymentEnabled } = readConfiguration().easyCredit;
  let webshopInfo: WebshopInfoResult;

  try {
    webshopInfo = await getWebshopInfo();
  } catch (error: unknown) {
    throw new Errorx({
      code: 'EasyCreditUnavailable',
      httpErrorStatus: 503,
      message: 'easyCredit ist derzeit nicht erreichbar. Bitte versuchen Sie es später erneut.',
      // The enabler needs the webShopId to render the widget with the alert.
      fields: { webShopId },
      cause: error,
    });
  }

  const {
    data: {
      availability,
      installmentPaymentActive,
      minInstallmentValue,
      maxInstallmentValue,
      billPaymentActive,
      minBillingValue,
      maxBillingValue,
    },
    isStale,
  } = webshopInfo;

  const isInstallmentEnabled = availability && installmentPaymentActive;
  // Bill payment must fail closed, so stale data from a failed refresh never offers it.
  const isBillEnabled =
    !isStale &&
    availability &&
    billPaymentEnabled === '1' &&
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
