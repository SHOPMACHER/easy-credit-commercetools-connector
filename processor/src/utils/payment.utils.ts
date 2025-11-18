import { Cart, Payment, Transaction } from '@commercetools/connect-payments-sdk';
import { CTTransactionState, CTTransactionType, ECBooking } from '../types/payment.types';
import {
  EASYCREDIT_CAPTURE_BOOKING_TYPE,
  EASYCREDIT_PAYMENT_METHOD,
  EASYCREDIT_REFUND_BOOKING_TYPE,
  EASYCREDIT_REFUND_STATUS_DONE,
  EASYCREDIT_REFUND_STATUS_FAILED,
} from './constant.utils';

export const getPendingTransaction = (payment: Payment): Transaction | undefined => {
  return payment.transactions.find(
    (transaction) =>
      transaction.type === CTTransactionType.Authorization && transaction.state === CTTransactionState.Pending,
  );
};

export const getSuccessTransaction = (payment: Payment): Transaction | undefined => {
  return payment.transactions.find(
    (transaction) =>
      transaction.type === CTTransactionType.Authorization && transaction.state === CTTransactionState.Success,
  );
};

export const getTransaction = (payment: Payment): Transaction | undefined => {
  return payment.transactions.find((transaction) => transaction.type === CTTransactionType.Authorization);
};

export const getInitialRefundTransaction = (payment: Payment): Transaction | undefined => {
  return payment.transactions.find(
    (transaction) => transaction.type === CTTransactionType.Refund && transaction.state === CTTransactionState.Initial,
  );
};

export const getPayment = (cart: Cart) => {
  return cart.paymentInfo?.payments?.find((payment) => {
    return payment.obj?.paymentMethodInfo?.paymentInterface?.toLowerCase() === EASYCREDIT_PAYMENT_METHOD;
  });
};

export const getPendingRefundTransactions = (payment: Payment): Transaction[] => {
  return payment.transactions.filter(
    (transaction) => transaction.type === CTTransactionType.Refund && transaction.state === CTTransactionState.Pending,
  );
};

export const getCompletedRefunds = (ecBookings: ECBooking[]) => {
  return ecBookings.filter(
    (item) =>
      item.bookingType === EASYCREDIT_REFUND_BOOKING_TYPE &&
      item.bookingId &&
      (item.status === EASYCREDIT_REFUND_STATUS_DONE || item.status === EASYCREDIT_REFUND_STATUS_FAILED),
  );
};

export const getCaptureBooking = (ecBookings: ECBooking[]) => {
  return ecBookings.filter(
    (item) =>
      item.bookingType === EASYCREDIT_CAPTURE_BOOKING_TYPE &&
      item.type === 'CAPTURE' &&
      (item.status === EASYCREDIT_REFUND_STATUS_DONE || item.status === EASYCREDIT_REFUND_STATUS_FAILED),
  );
};

export const getPendingCaptureTransactions = (payment: Payment): Transaction[] => {
  return payment.transactions.filter(
    (transaction) => transaction.type === CTTransactionType.Charge && transaction.state === CTTransactionState.Pending,
  );
};

export const getSuccessCaptureTransactions = (payment: Payment): Transaction[] => {
  return payment.transactions.filter(
    (transaction) => transaction.type === CTTransactionType.Charge && transaction.state === CTTransactionState.Success,
  );
};
