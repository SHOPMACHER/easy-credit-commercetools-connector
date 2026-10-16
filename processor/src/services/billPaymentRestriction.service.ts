import { Cart } from '@commercetools/connect-payments-sdk';
import { getProductTypesByKeys } from '../commercetools/productType.commercetools';
import { log } from '../libs/logger';
import { readConfiguration } from '../utils/config.utils';

// Cart items that rule out pay by invoice; both lists empty means it is allowed.
export type BillPaymentExclusion = {
  productTypeKeys: string[];
  customLineItems: string[];
};

type CachedProductTypes = {
  configuredKeys: string;
  keysById: Map<string, string>;
  expiresAt: number;
};

let cachedProductTypes: CachedProductTypes | undefined;

export const resetBillPaymentRestrictionCache = (): void => {
  cachedProductTypes = undefined;
};

// Line items only carry the product type id, so the configured keys are resolved once per cache TTL.
const getExcludedProductTypeKeysById = async (keys: string[], ttlSeconds: number): Promise<Map<string, string>> => {
  const configuredKeys = keys.join(',');

  if (cachedProductTypes?.configuredKeys === configuredKeys && cachedProductTypes.expiresAt > Date.now()) {
    return cachedProductTypes.keysById;
  }

  const productTypes = await getProductTypesByKeys(keys);
  const keysById = new Map(productTypes.flatMap(({ id, key }) => (key === undefined ? [] : [[id, key] as const])));

  const unknownKeys = keys.filter((key) => !productTypes.some((productType) => productType.key === key));
  if (unknownKeys.length > 0) {
    log.warn('Bill payment excluded product types do not exist', { productTypeKeys: unknownKeys });
  }

  cachedProductTypes = { configuredKeys, keysById, expiresAt: Date.now() + ttlSeconds * 1000 };

  return keysById;
};

// Throws if the product types cannot be resolved, so the caller can fail closed.
export const getBillPaymentExclusion = async (cart: Cart): Promise<BillPaymentExclusion> => {
  const {
    billPaymentExcludedProductTypes: excludedProductTypes,
    billPaymentExcludedCustomLineItems: excludedCustomLineItems,
    webshopCacheTtl,
  } = readConfiguration().easyCredit;

  const customLineItems = [
    ...new Set(
      cart.customLineItems.flatMap(({ slug, key }) => {
        if (excludedCustomLineItems.includes(slug)) {
          return [slug];
        }

        return key !== undefined && excludedCustomLineItems.includes(key) ? [key] : [];
      }),
    ),
  ];

  // A matching custom line item already excludes the cart, so a failing lookup must not hide it.
  if (customLineItems.length > 0 || excludedProductTypes.length === 0 || cart.lineItems.length === 0) {
    return { productTypeKeys: [], customLineItems };
  }

  const keysById = await getExcludedProductTypeKeysById(excludedProductTypes, Number(webshopCacheTtl));
  const productTypeKeys = [...new Set(cart.lineItems.flatMap(({ productType }) => keysById.get(productType.id) ?? []))];

  return { productTypeKeys, customLineItems };
};
