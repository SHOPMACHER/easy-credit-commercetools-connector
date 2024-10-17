import { Errorx } from '@commercetools/connect-payments-sdk';
import { createApiRoot } from '../client/create.client';
import { log } from '../libs/logger';
import { initEasyCreditClient } from "../client/easycredit.client";

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

export const updatePaymentStatus = async (paymentId: string, newStatus: string) => {
  try {
    // Get the payment to retrieve the current version and transactions
    const payment = await getPaymentById(paymentId);
    const paymentVersion = payment.version;

    // Find the transaction with type 'Authorization' and state 'Initial'
    const transaction = payment.transactions?.find(
        (tx) => tx.type === 'Authorization' && tx.state === 'Initial'
    );

    if (!transaction) {
      throw new Errorx({
        code: 'TransactionNotFound',
        message: 'No Authorization transaction with Initial state found.',
        httpErrorStatus: 404,
      });
    }

    const easyTransaction = await initEasyCreditClient().getPayment(transaction?.interactionId || 'c2b818bb.1017101417aBEK0At8kUEJLJxGnygmuWm1' as string);

    if (easyTransaction.status !== 'DECLINED') {
      throw new Errorx({
          code: 'TransactionNotDeclined',
          message: 'Transaction status is not DECLINED.',
          httpErrorStatus: 400,
      });
    }

    // Prepare the update request to change the payment status
    const response = await createApiRoot()
        .payments()
        .withId({ ID: paymentId })
        .post({
          body: {
            version: paymentVersion, // The current payment version
            actions: [
              {
                action: 'changeTransactionState',
                transactionId: transaction.id, // Use the found transaction ID
                state: newStatus, // Set the new status here
              },
            ],
          },
        })
        .execute();

    log.info(`Payment ${paymentId} cancelled successfully.`);

    return response.body; // Return the updated payment object
  } catch (error: any) {
    log.error('Error in updating CommerceTools Payment status', error);

    throw new Errorx({
      code: error?.code as string,
      message: error?.body?.message as string,
      httpErrorStatus: error?.statusCode,
      fields: error.body?.errors,
    });
  }
};


