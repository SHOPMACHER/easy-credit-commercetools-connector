import { Errorx, Payment, PaymentDraft } from '@commercetools/connect-payments-sdk';
import { createApiRoot } from '../client/create.client';
import { log } from '../libs/logger';
import { PaymentUpdateAction } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/payment';

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

export async function updatePayment(payment: Payment, updateActions: PaymentUpdateAction[]): Promise<Payment> {
  try {
    const response = await createApiRoot()
      .payments()
      .withId({ ID: payment.id })
      .post({
        body: {
          version: payment.version,
          actions: updateActions,
        },
      })
      .execute();
    const { body: paymentObject } = response;

    return paymentObject;
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

export async function createPayment(payment: PaymentDraft): Promise<Payment> {
  try {
    const response = await createApiRoot()
      .payments()
      .post({
        body: payment,
      })
      .execute();
    const { body: paymentObject } = response;

    return paymentObject;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    log.error('Error in createPayment', error);

    throw new Errorx({
      code: error?.code as string,
      message: error?.body?.message as string,
      httpErrorStatus: error?.statusCode,
      fields: error.body?.errors,
    });
  }
}
