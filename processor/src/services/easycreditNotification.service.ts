import { initEasyCreditClient } from '../client/easycredit.client';
import { getPaymentByEasyCreditRefundBookingId, updatePayment } from '../commercetools/payment.commercetools';
import { mapUpdateActionForRefunds } from '../utils/map.utils';
import { getCompletedRefunds, getPendingRefundTransactions } from '../utils/payment.utils';
import { log } from '../libs/logger';
import { Errorx } from '@commercetools/connect-payments-sdk';

export const handleEasyCreditNotification = async (resourceId: string) => {
  try {
    const ecTransaction = await initEasyCreditClient().getMerchantTransaction(resourceId);

    const ecCompletedRefunds = getCompletedRefunds(ecTransaction.bookings);

    if (ecCompletedRefunds.length === 0) {
      throw new Errorx({
        code: 'RefundNotFound',
        message: 'EasyCredit refund not found.',
        httpErrorStatus: 404,
      });
    }

    const ctPayment = await getPaymentByEasyCreditRefundBookingId(ecCompletedRefunds[0]?.bookingId as string);

    const ctPendingRefunds = getPendingRefundTransactions(ctPayment);

    if (ctPendingRefunds.length === 0) {
      return;
    }

    const updateActions = mapUpdateActionForRefunds(ctPendingRefunds, ecCompletedRefunds);

    if (updateActions.length > 0) {
      await updatePayment(ctPayment, updateActions);
    }
  } catch (error: unknown) {
    log.error('Error in handling EasyCredit notification', error);
    throw error;
  }
};
