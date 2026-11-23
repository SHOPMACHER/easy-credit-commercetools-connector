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
import {
  EASYCREDIT_BOOKING_STATUS_DONE,
  EASYCREDIT_BOOKING_STATUS_FAILED,
  EASYCREDIT_REFUND_BOOKING_TYPE,
} from '../utils/constant.utils';
import {
  getCaptureBooking,
  getCaptureResult,
  getCompletedRefunds,
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
    const { bookings } = ecTransaction;
    if (!bookings) {
      log.warn('EasyCredit sent the transaction without bookings, notification ignored', { resourceId });
      return;
    }

    // Both update the same payment, so they run one after the other; a failed refund update must not block the capture.
    const [refunds] = await Promise.allSettled([handleRefundNotifications(bookings)]);
    await handleCaptureNotifications(ecTransaction, bookings, resourceId);
    if (refunds.status === 'rejected') {
      throw refunds.reason;
    }
  } catch (error: unknown) {
    log.error('Error in handling EasyCredit notification', { resourceId, error });
    throw error;
  }
};

// A refund without any easyCredit booking stays open until someone checks it, see docs/RefundPayment.md#process.
const logRefundsLeftOpen = (payment: Payment, openRefunds: Transaction[], ecBookings: ECBooking[]): void => {
  const bookingStatus = new Map(
    ecBookings
      .filter(({ bookingType, bookingId }) => bookingType === EASYCREDIT_REFUND_BOOKING_TYPE && bookingId)
      .map(({ bookingId, status }) => [bookingId, status]),
  );
  const leftOpen = openRefunds
    .filter(({ id }) => {
      const status = bookingStatus.get(id);
      return status !== EASYCREDIT_BOOKING_STATUS_DONE && status !== EASYCREDIT_BOOKING_STATUS_FAILED;
    })
    .map(({ id, state, amount }) => ({
      transactionId: id,
      state,
      centAmount: amount.centAmount,
      ecBookingStatus: bookingStatus.get(id) ?? 'none',
    }));
  if (leftOpen.some(({ ecBookingStatus }) => ecBookingStatus === 'none')) {
    log.warn('Refunds without an easyCredit booking stay open and keep their amount', {
      paymentId: payment.id,
      refunds: leftOpen,
    });
  } else if (leftOpen.length > 0) {
    log.info('Refunds stay open while their easyCredit booking is processed', {
      paymentId: payment.id,
      refunds: leftOpen,
    });
  }
};

// Only a DONE or FAILED booking completes a refund: without one, easyCredit may still book it.
export const settleOpenRefunds = async (payment: Payment, ecBookings: ECBooking[]): Promise<Payment> => {
  const openRefunds = getOpenRefundTransactions(payment);
  if (openRefunds.length === 0) {
    return payment;
  }

  const completedRefunds = getCompletedRefunds(ecBookings);
  const updateActions = mapUpdateActionForRefunds(openRefunds, completedRefunds);
  logRefundsLeftOpen(payment, openRefunds, ecBookings);
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

  return updatedPayment;
};

const handleRefundNotifications = async (ecBookings: ECBooking[]): Promise<void> => {
  const firstRefundBookingId = getCompletedRefunds(ecBookings)[0]?.bookingId;
  if (!firstRefundBookingId) {
    return;
  }

  const ctPayment = await getPaymentByEasyCreditRefundBookingId(firstRefundBookingId);
  await settleOpenRefunds(ctPayment, ecBookings);
};

/**
 * Processes capture notifications and updates CommerceTools payment states
 */
const handleCaptureNotifications = async (
  ecTransaction: ECGetMerchantTransactionResponse,
  ecBookings: ECBooking[],
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

  const ecCaptureBookings = getCaptureBooking(ecBookings);

  if (ecCaptureBookings?.length === 0) {
    return;
  }

  const ctPayment = await getPaymentById(paymentId);
  const ctPendingCaptureTransactions = getPendingCaptureTransactions(ctPayment);
  const captureResult = getCaptureResult(ecCaptureBookings);

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
