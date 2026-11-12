import { Cart } from '@commercetools/connect-payments-sdk';
import { getProductTypesByKeys } from '../commercetools/productType.commercetools';
import { log } from '../libs/logger';
import { getPaymentTypeConfig, readConfiguration } from '../utils/config.utils';
import { ECTransactionPaymentType } from '../types/payment.types';

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

export const resetPaymentTypeRestrictionCache = (): void => {
  cachedProductTypes.clear();
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
