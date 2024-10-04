// import { Errorx } from "@commercetools/connect-payments-sdk";
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
