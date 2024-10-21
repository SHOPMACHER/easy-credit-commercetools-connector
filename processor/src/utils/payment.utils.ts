import { Cart, Payment } from '@commercetools/connect-payments-sdk';
import { CTTransactionState, CTTransactionType } from '../types/payment.types';
import { EASYCREDIT_PAYMENT_METHOD } from './constant.utils';

export const getPendingTransaction = (payment: Payment) => {
  return payment.transactions.find(
    (transaction) =>
      transaction.type === CTTransactionType.Authorization && transaction.state === CTTransactionState.Pending,
  );
};

export const getPayment = (cart: Cart) => {
  return cart.paymentInfo?.payments?.find((payment) => {
    return payment.obj?.paymentMethodInfo?.paymentInterface?.toLowerCase() === EASYCREDIT_PAYMENT_METHOD;
  });
};
