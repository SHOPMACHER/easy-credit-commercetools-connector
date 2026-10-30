import { Errorx } from '@commercetools/connect-payments-sdk';
import { Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { isNativeError } from 'node:util/types';
import { initEasyCreditClient } from '../client/easycredit.client';
import { log } from '../libs/logger';
import { ECTransactionPaymentType, ECWebshopInfo, PaymentTypesAvailability } from '../types/payment.types';
import { readConfiguration } from '../utils/config.utils';
import {
  EASYCREDIT_DEFAULT_MAX_INSTALLMENT_AMOUNT,
  EASYCREDIT_DEFAULT_MIN_INSTALLMENT_AMOUNT,
  EASYCREDIT_WEBSHOP_INFO_MAX_STALE_MS,
  EASYCREDIT_WEBSHOP_INFO_RETRY_MS,
} from '../utils/constant.utils';

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

// Used for installment while easyCredit is temporarily unreachable and no valid response is cached.
const DEFAULT_WEBSHOP_INFO: ECWebshopInfo = {
  availability: true,
  installmentPaymentActive: true,
  minInstallmentValue: EASYCREDIT_DEFAULT_MIN_INSTALLMENT_AMOUNT,
  maxInstallmentValue: EASYCREDIT_DEFAULT_MAX_INSTALLMENT_AMOUNT,
};

export type WebshopInfoResult = {
  data: ECWebshopInfo;
  // Set while the data is not a fresh easyCredit response.
  isStale: boolean;
};

type CachedWebshopInfo = {
  data?: ECWebshopInfo;
  // Remember deactivation or a permanent failure until a valid response replaces it.
  // This only blocks fallback; it never extends the lifetime of cached limits.
  installmentFallbackBlocked: boolean;
  expiresAt: number;
  // After this, failed refreshes no longer fall back to `data`.
  staleUntil: number;
  // Only set after a failed request.
  error?: unknown;
};

class InvalidWebshopInfoError extends Error {}

class WebshopInfoRetryError extends Error {}

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

// Native fetch errors can come from another realm, so instanceof SyntaxError is not sufficient.
const isInvalidResponse = (error: unknown): boolean =>
  error instanceof InvalidWebshopInfoError || (isNativeError(error) && error.name === 'SyntaxError');

// Other 4xx and invalid responses mean easyCredit changed the webshop config, so stale data must not hide them.
const isTransientError = (error: unknown): boolean => {
  if (isInvalidResponse(error)) {
    return false;
  }

  if (error instanceof Errorx) {
    const status = error.httpErrorStatus;

    return status >= 500 || status === 408 || status === 429;
  }

  return true;
};

// An invalid response says nothing about the installment config, so installment keeps the default limits as before.
const blocksInstallment = (error: unknown): boolean => !isTransientError(error) && !isInvalidResponse(error);

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
    cache({
      data,
      installmentFallbackBlocked: !data.availability || !data.installmentPaymentActive,
      expiresAt,
      staleUntil: expiresAt + EASYCREDIT_WEBSHOP_INFO_MAX_STALE_MS,
    });

    return { data, isStale: false };
  } catch (error: unknown) {
    const now = Date.now();
    // Wait before retrying so an outage does not make every checkout wait for the request timeout.
    const retryAt = now + EASYCREDIT_WEBSHOP_INFO_RETRY_MS;

    if (previous?.data && now < previous.staleUntil && isTransientError(error)) {
      cache({ ...previous, expiresAt: Math.min(retryAt, previous.staleUntil), error });
      log.warn('Failed to refresh easyCredit webshop info, using the last known data', error);

      return { data: previous.data, isStale: true };
    }

    cache({
      installmentFallbackBlocked: previous?.installmentFallbackBlocked === true || blocksInstallment(error),
      expiresAt: retryAt,
      staleUntil: 0,
      error,
    });
    log.error('Failed to fetch easyCredit webshop info', error);
    throw error;
  }
};

const requestWebshopInfo = (webShopId: string, cacheTtlSeconds: number): Promise<WebshopInfoResult> => {
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

const answerFromFailedState = ({ data, staleUntil, error }: CachedWebshopInfo): WebshopInfoResult => {
  if (data && Date.now() < staleUntil) {
    return { data, isStale: true };
  }

  throw new WebshopInfoRetryError(
    `easyCredit webshop info is unavailable, waiting for the next retry (${getErrorMessage(error)})`,
    { cause: error },
  );
};

export const getWebshopInfo = async (): Promise<WebshopInfoResult> => {
  const { webShopId, webshopCacheTtl } = readConfiguration().easyCredit;
  const cachedWebshopInfo = cachedWebshopInfoById.get(webShopId);
  const isExpired = !cachedWebshopInfo || cachedWebshopInfo.expiresAt <= Date.now();

  if (cachedWebshopInfo && 'error' in cachedWebshopInfo) {
    // During an outage only a background request retries easyCredit, so no checkout waits for the timeout.
    if (isExpired) {
      requestWebshopInfo(webShopId, Number(webshopCacheTtl)).catch(() => undefined);
    }

    return answerFromFailedState(cachedWebshopInfo);
  }

  if (cachedWebshopInfo?.data && !isExpired) {
    return { data: cachedWebshopInfo.data, isStale: false };
  }

  return requestWebshopInfo(webShopId, Number(webshopCacheTtl));
};

const getRetryAfterSeconds = (webShopId: string): number => {
  const expiresAt = cachedWebshopInfoById.get(webShopId)?.expiresAt ?? Date.now() + EASYCREDIT_WEBSHOP_INFO_RETRY_MS;

  return Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
};

const isWithinLimits = (amount: number, minAmount: number, maxAmount: number): boolean =>
  amount >= minAmount && amount <= maxAmount;

export const getPaymentTypesAvailability = async (amount: number): Promise<PaymentTypesAvailability> => {
  const { webShopId, billPaymentEnabled } = readConfiguration().easyCredit;
  // A background refresh may replace the cache before this request handles its previous failure.
  const installmentFallbackBlocked = cachedWebshopInfoById.get(webShopId)?.installmentFallbackBlocked === true;
  let webshopInfo: WebshopInfoResult;

  try {
    webshopInfo = await getWebshopInfo();
  } catch (error: unknown) {
    const cause = error instanceof WebshopInfoRetryError ? error.cause : error;

    if (blocksInstallment(cause) || installmentFallbackBlocked) {
      throw new Errorx({
        code: 'EasyCreditUnavailable',
        httpErrorStatus: 503,
        message: 'easyCredit ist derzeit nicht erreichbar. Bitte versuchen Sie es später erneut.',
        // The enabler needs the webShopId to render the widget with the alert.
        fields: { webShopId },
        privateFields: { retryAfterSeconds: getRetryAfterSeconds(webShopId) },
        cause: error,
      });
    }

    // Keep installment available during an outage, as before the webshop config was used; bill stays closed.
    log.warn('easyCredit webshop info is unavailable, offering installment with the default limits', error);
    webshopInfo = { data: DEFAULT_WEBSHOP_INFO, isStale: true };
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
  // Bill payment must fail closed, so stale or default data never offers it.
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
