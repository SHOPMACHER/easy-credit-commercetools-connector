import { Payment, Transaction } from '@commercetools/connect-payments-sdk';
import { initEasyCreditClient } from '../client/easycredit.client';
import {
  getPaymentByEasyCreditRefundBookingId,
  getPaymentById,
  updatePayment,
} from '../commercetools/payment.commercetools';
import { log } from '../libs/logger';
import { CTTransactionState, ECBooking, ECGetMerchantTransactionResponse } from '../types/payment.types';
import { mapPendingChargeTransaction, mapUpdateActionForRefunds } from '../utils/map.utils';
import { EASYCREDIT_BOOKING_STATUS_DONE, EASYCREDIT_BOOKING_STATUS_FAILED } from '../utils/constant.utils';
import {
  getCaptureBooking,
  getCaptureResult,
  getCompletedRefunds,
  getExpiredRefunds,
  getOpenRefundTransactions,
  getPendingCaptureTransactions,
  getSuccessCaptureTransactions,
  getSuccessTransaction,
} from '../utils/payment.utils';
import { validateECTransactionId } from '../validators/payment.validators';

export const handleEasyCreditNotification = async (resourceId: string): Promise<void> => {
  try {
    validateECTransactionId(resourceId);
    const ecTransaction = await initEasyCreditClient().getMerchantTransaction(resourceId);

    // Both update the same payment, so they run one after the other; a failed refund update must not block the capture.
    const [refunds] = await Promise.allSettled([handleRefundNotifications(ecTransaction)]);
    await handleCaptureNotifications(ecTransaction, resourceId);
    if (refunds.status === 'rejected') {
      throw refunds.reason;
    }
  } catch (error: unknown) {
    log.error('Error in handling EasyCredit notification', { resourceId, error });
    throw error;
  }
};

// Completes open refunds from their easyCredit bookings and fails the ones easyCredit never booked.
export const settleOpenRefunds = async (payment: Payment, ecBookings: ECBooking[]): Promise<Payment> => {
  const openRefunds = getOpenRefundTransactions(payment);
  if (openRefunds.length === 0) {
    return payment;
  }

  const completedRefunds = getCompletedRefunds(ecBookings);
  const expiredRefunds = getExpiredRefunds(openRefunds, ecBookings);
  const updateActions = [
    ...mapUpdateActionForRefunds(openRefunds, completedRefunds),
    ...expiredRefunds.map(({ id }) => ({
      action: 'changeTransactionState' as const,
      transactionId: id,
      state: CTTransactionState.Failure,
    })),
  ];
  if (updateActions.length === 0) {
    return payment;
  }

  const updatedPayment = await updatePayment(payment, updateActions);
  log.info('Refund transactions updated from the easyCredit bookings', { paymentId: payment.id });

  const openRefundIds = new Set(openRefunds.map(({ id }) => id));
  completedRefunds
    .filter(
      (booking) => booking.status === EASYCREDIT_BOOKING_STATUS_FAILED && openRefundIds.has(booking.bookingId ?? ''),
    )
    .forEach((booking) =>
      log.warn('EasyCredit refund failed, CommerceTools transaction state updated to Failure.', {
        paymentId: payment.id,
        transactionId: booking.bookingId,
        reason: booking.message?.messageEN,
      }),
    );
  expiredRefunds.forEach(({ id }) =>
    log.warn('EasyCredit has no booking for the refund, CommerceTools transaction state updated to Failure.', {
      paymentId: payment.id,
      transactionId: id,
    }),
  );

  return updatedPayment;
};

// Without a completed refund the order ID still finds the payment, so refunds easyCredit never booked can be failed.
const handleRefundNotifications = async (ecTransaction: ECGetMerchantTransactionResponse): Promise<void> => {
  const firstRefundBookingId = getCompletedRefunds(ecTransaction.bookings)[0]?.bookingId;
  const paymentId = ecTransaction.orderDetails?.orderId;

  let ctPayment: Payment;
  if (firstRefundBookingId) {
    ctPayment = await getPaymentByEasyCreditRefundBookingId(firstRefundBookingId);
  } else if (paymentId) {
    ctPayment = await getPaymentById(paymentId);
  } else {
    return;
  }

  await settleOpenRefunds(ctPayment, ecTransaction.bookings);
};

/**
 * Processes capture notifications and updates CommerceTools payment states
 */
const handleCaptureNotifications = async (
  ecTransaction: ECGetMerchantTransactionResponse,
  resourceId: string,
): Promise<void> => {
  if (!ecTransaction?.orderDetails) {
    log.warn('No order details found in EC transaction');
    return;
  }

  // EC orderId maps to CommerceTools paymentId
  const paymentId = ecTransaction.orderDetails?.orderId;

  if (!paymentId) {
    log.warn('No payment ID found in EC transaction order details');
    return;
  }

  const ecCaptureBookings = getCaptureBooking(ecTransaction.bookings);

  if (ecCaptureBookings?.length === 0) {
    return;
  }

  const ctPayment = await getPaymentById(paymentId);
  const ctPendingCaptureTransactions = getPendingCaptureTransactions(ctPayment);
  const captureResult = getCaptureResult(ecCaptureBookings, ctPendingCaptureTransactions[0]?.timestamp);

  if (!captureResult) {
    log.info('EasyCredit capture is still being processed', { paymentId });
    return;
  }

  const captureState =
    captureResult.status === EASYCREDIT_BOOKING_STATUS_DONE ? CTTransactionState.Success : CTTransactionState.Failure;
  const failureReason = captureResult.message?.messageEN;

  const ctSuccessCaptures = getSuccessCaptureTransactions(ctPayment);

  // No multiple capture processing
  if (ctSuccessCaptures?.length > 0) {
    log.warn('Capture transaction already marked as Success, no further action needed.', {
      paymentId: ctPayment.id,
      transactionId: ctSuccessCaptures[0].id,
    });
    return;
  }

  // Should change this logic on next major release
  if (ctPendingCaptureTransactions?.length === 0) {
    // Without a pending Charge there is nothing to fail, and repeated FAILED notifications must not add Charges.
    if (captureState === CTTransactionState.Failure) {
      log.warn('Failed EasyCredit capture without pending capture transaction, nothing to update.', {
        paymentId: ctPayment.id,
      });
      return;
    }
    const ctAuthorizedTransactions = getSuccessTransaction(ctPayment);
    if (!ctAuthorizedTransactions) {
      log.error('No authorized transaction found to create capture from.', {
        paymentId: ctPayment.id,
      });
      return;
    }
    const updatedPayment = await createCaptureTransactionFromAuthorized(ctPayment, ctAuthorizedTransactions);
    await completePendingCapture(
      updatedPayment,
      getPendingCaptureTransactions(updatedPayment)[0],
      captureState,
      failureReason,
    );
  } else {
    const pendingCapture = ctPendingCaptureTransactions[0];
    if (pendingCapture.interactionId !== resourceId) {
      log.error('Interaction ID mismatch for capture transaction.', {
        expected: resourceId,
        actual: pendingCapture.interactionId,
      });
      return;
    }
    await completePendingCapture(ctPayment, pendingCapture, captureState, failureReason);
  }
};

const createCaptureTransactionFromAuthorized = async (
  ctPayment: Payment,
  authorizedTransaction: Transaction,
): Promise<Payment> => {
  return await updatePayment(ctPayment, [
    { action: 'addTransaction', transaction: mapPendingChargeTransaction(authorizedTransaction) },
  ]);
};

const completePendingCapture = async (
  ctPayment: Payment,
  pendingCapture: Transaction,
  state: CTTransactionState.Success | CTTransactionState.Failure,
  failureReason?: string,
): Promise<Payment> => {
  const logContext = { transactionId: pendingCapture.id, paymentId: ctPayment.id };
  if (state === CTTransactionState.Success) {
    log.info(
      'EasyCredit payment captured successfully, CommerceTools transaction state updated to Success.',
      logContext,
    );
  } else {
    log.error('EasyCredit capture failed, CommerceTools transaction state updated to Failure.', {
      ...logContext,
      reason: failureReason,
    });
  }

  return await updatePayment(ctPayment, [
    {
      action: 'changeTransactionState',
      transactionId: pendingCapture.id,
      state,
    },
  ]);
};
