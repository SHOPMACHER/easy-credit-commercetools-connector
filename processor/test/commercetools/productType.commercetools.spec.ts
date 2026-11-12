import { getProductTypesByKeys } from '../../src/commercetools/productType.commercetools';
import { createApiRoot } from '../../src/client/create.client';

jest.mock('../../src/client/create.client');

describe('getProductTypesByKeys', () => {
  it('should query the product types by key', async () => {
    const results = [{ id: 'pt-voucher', key: 'voucher' }];
    const get = jest.fn().mockReturnValue({ execute: jest.fn().mockResolvedValue({ body: { results } }) });
    (createApiRoot as jest.Mock).mockReturnValue({ productTypes: jest.fn(() => ({ get })) });

    await expect(getProductTypesByKeys(['voucher', 'gift-card'])).resolves.toEqual(results);
    expect(get).toHaveBeenCalledWith({
      queryArgs: { where: 'key in :keys', 'var.keys': ['voucher', 'gift-card'], limit: 2 },
    });
  });
});
