import { Payment, Transaction } from '@commercetools/connect-payments-sdk';
import { initEasyCreditClient } from '../client/easycredit.client';
import {
  getPaymentByEasyCreditRefundBookingId,
  getPaymentById,
  updatePayment,
} from '../commercetools/payment.commercetools';
import { log } from '../libs/logger';
import { CTTransactionState, CTTransactionType, ECGetMerchantTransactionResponse } from '../types/payment.types';
import { mapUpdateActionForRefunds } from '../utils/map.utils';
import {
  getCaptureBooking,
  getCompletedRefunds,
  getPendingCaptureTransactions,
  getPendingRefundTransactions,
  getSuccessCaptureTransactions,
  getSuccessTransaction,
} from '../utils/payment.utils';
import { validateECTransactionId } from '../validators/payment.validators';

export const handleEasyCreditNotification = async (resourceId: string): Promise<void> => {
  try {
    validateECTransactionId(resourceId);
    const ecTransaction = await initEasyCreditClient().getMerchantTransaction(resourceId);

    await Promise.all([
      handleRefundNotifications(ecTransaction),
      handleCaptureNotifications(ecTransaction, resourceId),
    ]);
  } catch (error: unknown) {
    log.error('Error in handling EasyCredit notification', { resourceId, error });
    throw error;
  }
};

/**
 * Processes refund notifications and updates CommerceTools payment states
 */
const handleRefundNotifications = async (ecTransaction: ECGetMerchantTransactionResponse): Promise<void> => {
  const ecCompletedRefunds = getCompletedRefunds(ecTransaction.bookings);

  if (ecCompletedRefunds.length === 0) {
    return;
  }

  const firstRefundBookingId = ecCompletedRefunds[0]?.bookingId;
  if (!firstRefundBookingId) {
    log.error('No booking ID found for completed refund');
    return;
  }

  const ctPayment = await getPaymentByEasyCreditRefundBookingId(firstRefundBookingId);
  const ctPendingRefunds = getPendingRefundTransactions(ctPayment);

  if (ctPendingRefunds?.length === 0) {
    log.info('No pending refund transactions to update', { paymentId: ctPayment.id });
    return;
  }
  const updateActions = mapUpdateActionForRefunds(ctPendingRefunds, ecCompletedRefunds);

  if (updateActions?.length > 0) {
    await updatePayment(ctPayment, updateActions);
    log.info('Successfully updated refund transactions from EasyCredit notification', {
      paymentId: ctPayment.id,
    });
  }
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
  const ctSuccessCaptures = getSuccessCaptureTransactions(ctPayment);

  // No multiple capture processing
  if (ctSuccessCaptures?.length > 0) {
    log.warn('Capture transaction already marked as Success, no further action needed.', {
      paymentId: ctPayment.id,
      transactionId: ctSuccessCaptures[0].id,
    });
    return;
  }

  const ctPendingCaptureTransactions = getPendingCaptureTransactions(ctPayment);
  // Should change this logic on next major release
  if (ctPendingCaptureTransactions?.length === 0) {
    const ctAuthorizedTransactions = getSuccessTransaction(ctPayment);
    if (!ctAuthorizedTransactions) {
      log.error('No authorized transaction found to create capture from.', {
        paymentId: ctPayment.id,
      });
      return;
    }
    const updatedPayment = await createCaptureTransactionFromAuthorized(ctPayment, ctAuthorizedTransactions);
    await updatePendingCaptureToSuccess(updatedPayment, getPendingCaptureTransactions(updatedPayment)[0]);
  } else {
    const pendingCapture = ctPendingCaptureTransactions[0];
    if (pendingCapture.interactionId !== resourceId) {
      log.error('Interaction ID mismatch for capture transaction.', {
        expected: resourceId,
        actual: pendingCapture.interactionId,
      });
      return;
    }
    await updatePendingCaptureToSuccess(ctPayment, pendingCapture);
  }
};

const createCaptureTransactionFromAuthorized = async (
  ctPayment: Payment,
  authorizedTransaction: Transaction,
): Promise<Payment> => {
  return await updatePayment(ctPayment, [
    {
      action: 'addTransaction',
      transaction: {
        type: CTTransactionType.Charge,
        state: CTTransactionState.Pending,
        amount: authorizedTransaction.amount,
        interactionId: authorizedTransaction.interactionId,
        timestamp: new Date().toISOString(),
        custom: authorizedTransaction.custom,
      },
    },
  ]);
};

const updatePendingCaptureToSuccess = async (ctPayment: Payment, pendingCapture: Transaction): Promise<Payment> => {
  log.info('EasyCredit payment captured successfully, CommerceTools transaction state updated to Success.', {
    transactionId: pendingCapture.id,
    paymentId: ctPayment.id,
  });

  return await updatePayment(ctPayment, [
    {
      action: 'changeTransactionState',
      transactionId: pendingCapture.id,
      state: CTTransactionState.Success,
    },
  ]);
};
