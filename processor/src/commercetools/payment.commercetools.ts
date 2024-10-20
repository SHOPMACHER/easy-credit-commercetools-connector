import { Errorx } from '@commercetools/connect-payments-sdk';
import { createApiRoot } from '../client/create.client';
import { log } from '../libs/logger';

export const getPaymentById = async (paymentId: string) => {
  try {
    const response = await createApiRoot().payments().withId({ ID: paymentId }).get().execute();

    const { body: paymentObject } = response;

    return paymentObject;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    log.error('Error in getting CommerceTools Payment', error);

    throw new Errorx({
      code: error?.code as string,
      message: error?.body?.message as string,
      httpErrorStatus: error?.statusCode,
      fields: error.body?.errors,
    });
  }
};
