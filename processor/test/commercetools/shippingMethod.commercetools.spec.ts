import { describe, expect, it, jest } from '@jest/globals';
import { Cart, Errorx } from '@commercetools/connect-payments-sdk';
import { getMatchingShippingMethods } from '../../src/commercetools/shippingMethod.commercetools';
import { createApiRoot } from '../../src/client/create.client';

jest.mock('../../src/client/create.client');
jest.mock('../../src/libs/logger');

const mockMatchingCart = (execute: jest.Mock) => {
  const get = jest.fn(() => ({ execute }));
  const shippingMethods = jest.fn(() => ({ matchingCart: () => ({ get }), matchingCartLocation: () => ({ get }) }));
  const inStoreKeyWithStoreKeyValue = jest.fn(() => ({ shippingMethods }));
  (createApiRoot as jest.Mock).mockReturnValue({ shippingMethods, inStoreKeyWithStoreKeyValue });

  return { get, inStoreKeyWithStoreKeyValue };
};

describe('getMatchingShippingMethods', () => {
  it('should return the shipping methods matching the cart', async () => {
    const results = [{ id: 'standard', isDefault: true }];
    const { get, inStoreKeyWithStoreKeyValue } = mockMatchingCart(
      jest.fn<() => Promise<unknown>>().mockResolvedValue({ body: { results } }),
    );

    await expect(getMatchingShippingMethods({ id: 'cart-1' } as Cart)).resolves.toEqual(results);
    expect(get).toHaveBeenCalledWith({ queryArgs: { cartId: 'cart-1' } });
    expect(inStoreKeyWithStoreKeyValue).not.toHaveBeenCalled();
  });

  it('should match a cart without address against the given country', async () => {
    const results = [{ id: 'standard', isDefault: true }];
    const { get, inStoreKeyWithStoreKeyValue } = mockMatchingCart(
      jest.fn<() => Promise<unknown>>().mockResolvedValue({ body: { results } }),
    );

    await expect(
      getMatchingShippingMethods({ id: 'cart-1', store: { typeId: 'store', key: 'de-store' } } as Cart, 'DE'),
    ).resolves.toEqual(results);
    expect(get).toHaveBeenCalledWith({ queryArgs: { cartId: 'cart-1', country: 'DE' } });
    // The project endpoint applies the store of the cart itself.
    expect(inStoreKeyWithStoreKeyValue).not.toHaveBeenCalled();
  });

  it('should include the methods of the store for a store cart', async () => {
    const { inStoreKeyWithStoreKeyValue } = mockMatchingCart(
      jest.fn<() => Promise<unknown>>().mockResolvedValue({ body: { results: [] } }),
    );

    await getMatchingShippingMethods({ id: 'cart-1', store: { typeId: 'store', key: 'de-store' } } as Cart);

    expect(inStoreKeyWithStoreKeyValue).toHaveBeenCalledWith({ storeKey: 'de-store' });
  });

  it('should turn a commercetools error into an Errorx', async () => {
    mockMatchingCart(
      jest
        .fn<() => Promise<unknown>>()
        .mockRejectedValue({ code: 'InvalidOperation', statusCode: 400, body: { message: 'no address', errors: [] } }),
    );

    await expect(getMatchingShippingMethods({ id: 'cart-1' } as Cart)).rejects.toEqual(
      expect.objectContaining({ code: 'InvalidOperation', httpErrorStatus: 400 }),
    );
    await expect(getMatchingShippingMethods({ id: 'cart-1' } as Cart)).rejects.toBeInstanceOf(Errorx);
  });
});
