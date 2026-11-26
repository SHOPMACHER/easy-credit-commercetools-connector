import { Cart } from '@commercetools/connect-payments-sdk';
import { getProductTypesByKeys } from '../commercetools/productType.commercetools';
import { log } from '../libs/logger';
import { getPaymentTypeConfig, readConfiguration } from '../utils/config.utils';
import { ECTransactionPaymentType } from '../types/payment.types';
import { EASYCREDIT_WEBSHOP_INFO_RETRY_MS } from '../utils/constant.utils';

// Cart items that rule out a payment type; both lists empty means it is allowed.
type PaymentTypeItemExclusion = {
  productTypeKeys: string[];
  customLineItems: string[];
};

type CachedProductTypes = {
  keysById: Map<string, string>;
  expiresAt: number;
};

// Per payment type, as each type has its own list of excluded product types.
const cachedProductTypes = new Map<ECTransactionPaymentType, CachedProductTypes>();

// PDP lookups, held per payment type while in flight and for the retry window after they settle.
type PdpLookup = { expiresAt: number; result: Promise<Map<string, string> | 'failed'> };
const pdpLookups = new Map<ECTransactionPaymentType, PdpLookup>();
// Same pause as for a failed webshop info request: unauthenticated PDP traffic must not retry commercetools faster.
const PDP_LOOKUP_HOLD_MS = EASYCREDIT_WEBSHOP_INFO_RETRY_MS;

export const resetPaymentTypeRestrictionCache = (): void => {
  cachedProductTypes.clear();
  pdpLookups.clear();
};

// Line items only carry the product type id, so the configured keys are resolved once per cache TTL.
const getExcludedProductTypeKeysById = async (
  paymentType: ECTransactionPaymentType,
  keys: string[],
  ttlSeconds: number,
): Promise<Map<string, string>> => {
  const cached = cachedProductTypes.get(paymentType);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.keysById;
  }

  const productTypes = await getProductTypesByKeys(keys);
  const keysById = new Map(productTypes.flatMap(({ id, key }) => (key === undefined ? [] : [[id, key] as const])));

  // Not cached, so a product type created after the lookup excludes carts on the next request.
  const unknownKeys = keys.filter((key) => !productTypes.some((productType) => productType.key === key));
  if (unknownKeys.length > 0) {
    log.warn('Excluded product types do not exist', { paymentType, productTypeKeys: unknownKeys });
    return keysById;
  }

  cachedProductTypes.set(paymentType, { keysById, expiresAt: Date.now() + ttlSeconds * 1000 });

  return keysById;
};

// Throws if the product types cannot be resolved, so the caller can fail closed.
export const getPaymentTypeExclusion = async (
  cart: Cart,
  paymentType: ECTransactionPaymentType,
): Promise<PaymentTypeItemExclusion> => {
  const { easyCredit } = readConfiguration();
  const { excludedProductTypes, excludedCustomLineItems } = getPaymentTypeConfig(easyCredit, paymentType);

  const customLineItems = cart.customLineItems
    .filter(({ slug, key }) =>
      [slug, key].some((value) => value !== undefined && excludedCustomLineItems.includes(value)),
    )
    .map(({ slug }) => slug);

  // A matching custom line item already excludes the cart, so a failing lookup must not hide it.
  if (customLineItems.length > 0 || excludedProductTypes.length === 0 || cart.lineItems.length === 0) {
    return { productTypeKeys: [], customLineItems };
  }

  const keysById = await getExcludedProductTypeKeysById(
    paymentType,
    excludedProductTypes,
    Number(easyCredit.webshopCacheTtl),
  );
  const productTypeKeys = [...new Set(cart.lineItems.flatMap(({ productType }) => keysById.get(productType.id) ?? []))];

  return { productTypeKeys, customLineItems };
};

export const getPaymentTypesWithProductTypeExclusions = (): ECTransactionPaymentType[] => {
  const { easyCredit } = readConfiguration();
  return Object.values(ECTransactionPaymentType).filter(
    (paymentType) => getPaymentTypeConfig(easyCredit, paymentType).excludedProductTypes.length > 0,
  );
};

// Holds unknown keys and failures too, so public PDP traffic cannot hammer commercetools.
const lookupExcludedProductTypes = (
  paymentType: ECTransactionPaymentType,
  keys: string[],
  ttlSeconds: number,
): PdpLookup['result'] => {
  const held = pdpLookups.get(paymentType);
  if (held && held.expiresAt > Date.now()) {
    return held.result;
  }

  // Expires from the start: the commercetools client has no timeout, so a hung call must not be reused forever.
  const lookup: PdpLookup = {
    expiresAt: Date.now() + PDP_LOOKUP_HOLD_MS,
    result: Promise.resolve('failed'),
  };
  lookup.result = getExcludedProductTypeKeysById(paymentType, keys, ttlSeconds)
    .catch((error: unknown): 'failed' => {
      log.warn('Excluded product type lookup failed', { paymentType, error });
      return 'failed';
    })
    .finally(() => {
      lookup.expiresAt = Date.now() + PDP_LOOKUP_HOLD_MS;
    });
  pdpLookups.set(paymentType, lookup);

  return lookup.result;
};

// A type whose lookup failed counts as excluding the product type.
export const getPaymentTypesExcludingProductType = async (
  productTypeId: string,
): Promise<ECTransactionPaymentType[]> => {
  const { easyCredit } = readConfiguration();
  const excluding = await Promise.all(
    getPaymentTypesWithProductTypeExclusions().map(async (paymentType) => {
      const keysById = await lookupExcludedProductTypes(
        paymentType,
        getPaymentTypeConfig(easyCredit, paymentType).excludedProductTypes,
        Number(easyCredit.webshopCacheTtl),
      );
      return keysById === 'failed' || keysById.has(productTypeId) ? [paymentType] : [];
    }),
  );

  return excluding.flat();
};
