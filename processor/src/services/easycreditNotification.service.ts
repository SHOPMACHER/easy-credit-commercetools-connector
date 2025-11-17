import { initEasyCreditClient } from '../client/easycredit.client';
import {
  getPaymentByEasyCreditRefundBookingId,
  getPaymentById,
  updatePayment,
} from '../commercetools/payment.commercetools';
import { mapUpdateActionForRefunds } from '../utils/map.utils';
import {
  getCaptureBooking,
  getCompletedRefunds,
  getPendingCaptureTransactions,
  getPendingRefundTransactions,
} from '../utils/payment.utils';
import { log } from '../libs/logger';
import { validateECTransactionId } from '../validators/payment.validators';
import { CTTransactionState } from '../types/payment.types';

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
const handleRefundNotifications = async (ecTransaction: any): Promise<void> => {
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
    log.error('No pending refund transactions to update');
    return;
  }
  const updateActions = mapUpdateActionForRefunds(ctPendingRefunds, ecCompletedRefunds);

  if (updateActions?.length > 0) {
    await updatePayment(ctPayment, updateActions);
    log.info(`Updated ${updateActions.length} refund transactions`, { paymentId: ctPayment.id });
  }
};

/**
 * Processes capture notifications and updates CommerceTools payment states
 */
const handleCaptureNotifications = async (ecTransaction: any, resourceId: string): Promise<void> => {
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
  const ctPendingCaptures = getPendingCaptureTransactions(ctPayment);

  if (ctPendingCaptures?.length === 0) {
    log.info('No pending capture transactions to update');
    return;
  }

  const pendingCapture = ctPendingCaptures[0];
  if (pendingCapture.interactionId !== resourceId) {
    log.warn('Interaction ID mismatch for capture transaction.', {
      expected: resourceId,
      actual: pendingCapture.interactionId,
    });
    return;
  }

  await updatePayment(ctPayment, [
    {
      action: 'changeTransactionState',
      transactionId: pendingCapture.id,
      state: CTTransactionState.Success,
    },
  ]);

  log.info('EC successfully capture payment, move CT transaction state to Success.', {
    transactionId: pendingCapture.id,
    paymentId: ctPayment.id,
  });
};
