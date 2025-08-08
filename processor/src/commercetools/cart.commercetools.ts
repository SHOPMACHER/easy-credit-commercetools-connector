import { Cart, Errorx } from '@commercetools/connect-payments-sdk';
import { createApiRoot } from '../client/create.client';
import { log } from '../libs/logger';
import { CartUpdateAction } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/cart';

export const getCartById = async (cartId: string) => {
  try {
    const response = await createApiRoot().carts().withId({ ID: cartId }).get().execute();

    const { body: cartObject } = response;

    return cartObject;
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

export const getCartByPaymentId = async (paymentId: string) => {
  const carts = await createApiRoot()
    .carts()
    .get({
      queryArgs: {
        where: `paymentInfo(payments(id="${paymentId}"))`,
        limit: 1,
      },
    })
    .execute();

  if (carts.body.count === 0) {
    log.error(`Cart not found for payment ID: ${paymentId}`);

    throw new Errorx({
      code: 'CartNotFound',
      message: 'Cart not found.',
      httpErrorStatus: 404,
    });
  }

  return carts.body.results[0];
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
