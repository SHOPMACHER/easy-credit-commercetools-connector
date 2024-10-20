import { Payment } from '@commercetools/connect-payments-sdk';
import { CTTransactionState, CTTransactionType } from '../types/payment.types';

export const getPendingTransaction = (payment: Payment) => {
  return payment.transactions.find(
    (transaction) =>
      transaction.type === CTTransactionType.Authorization && transaction.state === CTTransactionState.Pending,
  );
};
