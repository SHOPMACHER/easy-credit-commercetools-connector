import { Cart, Errorx } from '@commercetools/connect-payments-sdk';
import { ShippingMethod } from '@commercetools/platform-sdk';
import { createApiRoot } from '../client/create.client';
import { log } from '../libs/logger';

const fetchShippingMethods = async (cart: Cart, country?: string): Promise<ShippingMethod[]> => {
  if (country) {
    // The project endpoint applies the store of the cart; there is no in-store variant for a location.
    return (
      await createApiRoot()
        .shippingMethods()
        .matchingCartLocation()
        .get({ queryArgs: { cartId: cart.id, country } })
        .execute()
    ).body.results;
  }

  const shippingMethods = cart.store
    ? createApiRoot().inStoreKeyWithStoreKeyValue({ storeKey: cart.store.key }).shippingMethods()
    : createApiRoot().shippingMethods();

  return (
    await shippingMethods
      .matchingCart()
      .get({ queryArgs: { cartId: cart.id } })
      .execute()
  ).body.results;
};

// Without country the cart needs a shipping address. A store cart also matches the methods of its store.
export const getMatchingShippingMethods = async (cart: Cart, country?: string): Promise<ShippingMethod[]> => {
  try {
    return await fetchShippingMethods(cart, country);
  } catch (error: any) {
    log.error('Error in getting the shipping methods matching the cart', {
      cartId: cart.id,
      code: error?.code,
      statusCode: error?.statusCode,
      message: error?.body?.message,
    });

    throw new Errorx({
      code: error?.code as string,
      message: error?.body?.message as string,
      httpErrorStatus: error?.statusCode,
      fields: error?.body?.errors,
    });
  }
};
