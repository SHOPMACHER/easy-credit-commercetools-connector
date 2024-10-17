import { Errorx } from '@commercetools/connect-payments-sdk';
import { createApiRoot } from '../client/create.client';
import { log } from '../libs/logger';

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

export const unfreezeCartById = async (paymentId: string) => {
  try {
    const carts = await createApiRoot().carts().get({
      queryArgs: {
        where: 'paymentInfo(payments(id="' + paymentId + '"))',
        limit: 1
      }
    }).execute();

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

