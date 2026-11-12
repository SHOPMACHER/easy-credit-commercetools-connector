import { ProductType } from '@commercetools/platform-sdk';
import { createApiRoot } from '../client/create.client';

export const getProductTypesByKeys = async (keys: string[]): Promise<ProductType[]> => {
  const {
    body: { results },
  } = await createApiRoot()
    .productTypes()
    .get({ queryArgs: { where: 'key in :keys', 'var.keys': keys, limit: keys.length } })
    .execute();

  return results;
};
