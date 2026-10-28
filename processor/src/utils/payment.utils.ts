import { Cart, Payment, Transaction } from '@commercetools/connect-payments-sdk';
import { CTTransactionState, CTTransactionType, ECBooking, ECTransactionPaymentType } from '../types/payment.types';
import {
  EASYCREDIT_BOOKING_STATUS_DONE,
  EASYCREDIT_BOOKING_STATUS_FAILED,
  EASYCREDIT_CAPTURE_BOOKING_TYPE,
  EASYCREDIT_PAYMENT_METHOD,
  EASYCREDIT_REFUND_BOOKING_TYPE,
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

// The update is version-locked, so the one ID missing before it is the transaction this request added; CT does not specify the array order.
export const getAddedTransaction = (
  before: Payment,
  after: Payment,
  type: CTTransactionType,
  state: CTTransactionState,
): Transaction | undefined => {
  const existingIds = new Set(before.transactions.map((transaction) => transaction.id));

  return after.transactions.find(
    (transaction) => !existingIds.has(transaction.id) && transaction.type === type && transaction.state === state,
  );
};

export const getActiveCaptureTransaction = (payment: Payment): Transaction | undefined => {
  return payment.transactions.find(
    (transaction) =>
      transaction.type === CTTransactionType.Charge &&
      (transaction.state === CTTransactionState.Pending || transaction.state === CTTransactionState.Success),
  );
};

export const getPayment = (cart: Cart) => {
  return cart.paymentInfo?.payments?.find((payment) => {
    return payment.obj?.paymentMethodInfo?.paymentInterface?.toLowerCase() === EASYCREDIT_PAYMENT_METHOD;
  });
};

// An Initial refund was possibly booked at easyCredit even though its Pending write failed.
export const getOpenRefundTransactions = (payment: Payment): Transaction[] => {
  return payment.transactions.filter(
    (transaction) =>
      transaction.type === CTTransactionType.Refund &&
      (transaction.state === CTTransactionState.Initial || transaction.state === CTTransactionState.Pending),
  );
};

export const getCompletedRefunds = (ecBookings: ECBooking[]) => {
  return ecBookings.filter(
    (item) =>
      item.bookingType === EASYCREDIT_REFUND_BOOKING_TYPE &&
      item.bookingId &&
      (item.status === EASYCREDIT_BOOKING_STATUS_DONE || item.status === EASYCREDIT_BOOKING_STATUS_FAILED),
  );
};

export const getCaptureBooking = (ecBookings: ECBooking[]) => {
  return ecBookings.filter((item) => item.bookingType === EASYCREDIT_CAPTURE_BOOKING_TYPE && item.type === 'CAPTURE');
};

// A DONE booking is final. Otherwise the newest booking decides, as a retried capture leaves the earlier FAILED one behind.
export const getCaptureResult = (captureBookings: ECBooking[]): ECBooking | undefined => {
  const done = captureBookings.find(({ status }) => status === EASYCREDIT_BOOKING_STATUS_DONE);
  if (done) {
    return done;
  }
  const latest = captureBookings.reduce<ECBooking | undefined>(
    (newest, booking) => (!newest || Date.parse(booking.created) > Date.parse(newest.created) ? booking : newest),
    undefined,
  );
  return latest?.status === EASYCREDIT_BOOKING_STATUS_FAILED ? latest : undefined;
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

export const getPaymentType = (payment: Payment): ECTransactionPaymentType =>
  payment.paymentMethodInfo?.method === ECTransactionPaymentType.ECTransactionBillPayment
    ? ECTransactionPaymentType.ECTransactionBillPayment
    : ECTransactionPaymentType.ECTransactionInstallmentPayment;
