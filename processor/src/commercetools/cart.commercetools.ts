import { Cart, Errorx } from '@commercetools/connect-payments-sdk';
import { createApiRoot } from '../client/create.client';
import { log } from '../libs/logger';
import { CartUpdateAction } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/cart';

export const getCartById = async (cartId: string) => {
  try {
    const response = await createApiRoot().carts().withId({ ID: cartId }).get().execute();

    const { body: cartObject } = response;

    return cartObject;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    log.error('Error in getting CommerceTools Cart', error);

    throw new Errorx({
      code: error?.code as string,
      message: error?.body?.message as string,
      httpErrorStatus: error?.statusCode,
      fields: error.body.errors,
    });
  }
};

export async function updateCart(cart: Cart, updateActions: CartUpdateAction[]): Promise<Cart> {
  try {
    const response = await createApiRoot()
      .carts()
      .withId({ ID: cart.id })
      .post({
        body: {
          version: cart.version,
          actions: updateActions,
        },
      })
      .execute();
    const { body: cartObject } = response;

    return cartObject;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    log.error('Error in updatePayment', error);

    throw new Errorx({
      code: error?.code as string,
      message: error?.body?.message as string,
      httpErrorStatus: error?.statusCode,
      fields: error.body?.errors,
    });
  }
}

export const unfreezeCartById = async (paymentId: string) => {
  try {
    const carts = await createApiRoot()
      .carts()
      .get({
        queryArgs: {
          where: 'paymentInfo(payments(id="' + paymentId + '"))',
          limit: 1,
        },
      })
      .execute();

    // throw error if cart is not found
    if (carts.body.count === 0) {
      throw new Errorx({
        code: 'CartNotFound',
        message: 'Cart not found.',
        httpErrorStatus: 404,
      });
    }

    const cartId = carts.body.results[0].id;

    // Get the cart to retrieve the current version
    const cart = await getCartById(cartId);
    const cartVersion = cart.version;

    // Send the request to unfreeze the cart by setting the cartState back to "Active"
    const response = await createApiRoot()
      .carts()
      .withId({ ID: cartId })
      .post({
        body: {
          version: cartVersion,
          actions: [
            {
              action: 'unfreezeCart',
            },
          ],
        },
      })
      .execute();

    log.info(`${cartId} cart unfrozen.`);

    return response.body;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    log.error('Error in unfreezing CommerceTools Cart', error);

    throw new Errorx({
      code: error?.code as string,
      message: error?.body?.message as string,
      httpErrorStatus: error?.statusCode,
      fields: error.body?.errors,
    });
  }
};
