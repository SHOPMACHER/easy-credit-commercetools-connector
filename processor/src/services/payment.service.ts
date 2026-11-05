import { Cart, Errorx, MultiErrorx, Payment, Transaction } from '@commercetools/connect-payments-sdk';
import { getCartById, getCartByPaymentId, updateCart } from '../commercetools/cart.commercetools';
import { readConfiguration } from '../utils/config.utils';

import {
  CTCartState,
  CTTransactionState,
  CTTransactionType,
  ECRefundPayload,
  ECTransactionCustomerRelationship,
  ECTransactionDecision,
  ECTransactionRedirectLinksWithoutAuthorizationCallback,
  ECTransactionStatus,
  GetPaymentMethodResponse,
  GetPaymentResponse,
  PaymentResponse,
} from '../types/payment.types';
import { log } from '../libs/logger';
import {
  isEasyCreditPayment,
  validateAddresses,
  validateCartAmount,
  validateCurrency,
  validateInitialOrPendingTransaction,
  validateInitialRefundTransaction,
  validatePayment,
  validatePaymentAmount,
  validatePendingTransaction,
  validateSuccessTransaction,
  validateTransaction,
} from '../validators/payment.validators';
import { createPayment, getPaymentById, updatePayment } from '../commercetools/payment.commercetools';
import { getPendingTransaction, getSuccessTransaction, getTransaction } from '../utils/payment.utils';
import { initEasyCreditClient } from '../client/easycredit.client';
import {
  getShippingAddress,
  mapAmountToCTTransactionAmount,
  mapCreatePaymentResponse,
  mapCTCartToCTPayment,
  mapCTCartToECPayment,
} from '../utils/map.utils';
import { convertCentsToEur } from '../utils/app.utils';
import { getTransactionCustomTypeKey } from '../utils/constant.utils';

// Helper to handle validation and return errors
const validateCart = (cart: Cart): Errorx[] => {
  const config = readConfiguration().easyCredit;
  const errors: Errorx[] = [];

  const billingAddress = cart.billingAddress;
  const shippingAddress = getShippingAddress(cart);

  validateAddresses(billingAddress, shippingAddress, { webShopId: config.webShopId }, errors);
  validateCurrency(cart.totalPrice.currencyCode, { webShopId: config.webShopId }, errors);
  validateCartAmount(
    cart.totalPrice.centAmount,
    cart.totalPrice.fractionDigits,
    { webShopId: config.webShopId },
    errors,
  );

  return errors;
};

export const handlePaymentMethod = async (cartId: string): Promise<GetPaymentMethodResponse> => {
  try {
    const cart = await getCartById(cartId);
    const errors = validateCart(cart);

    if (errors.length > 0) {
      throw new MultiErrorx(errors);
    }

    return {
      webShopId: readConfiguration().easyCredit.webShopId,
      amount: convertCentsToEur(cart.totalPrice.centAmount, cart.totalPrice.fractionDigits),
    };
  } catch (error: unknown) {
    log.error('Error in getting EasyCredit Payment Method', error);
    throw error;
  }
};

// Handle payment creation logic
export const handleCreatePayment = async (
  cartId: string,
  redirectLinks: ECTransactionRedirectLinksWithoutAuthorizationCallback,
  customerRelationship: ECTransactionCustomerRelationship,
): Promise<PaymentResponse> => {
  let cart: Cart | null = null;
  let newPaymentId: string | undefined;
  try {
    cart = await getCartById(cartId);
    const errors = validateCart(cart);

    if (errors.length > 0) {
      throw new MultiErrorx(errors);
    }

    await supersedeInitialPayments(cart);

    if (cart.cartState !== CTCartState.Frozen) {
      cart = await updateCart(cart, [{ action: 'freezeCart' }]);
    }

    const ctPayment = await createPayment(mapCTCartToCTPayment(cart));
    newPaymentId = ctPayment.id;
    cart = await updateCart(cart, [{ action: 'addPayment', payment: { typeId: 'payment', id: ctPayment.id } }]);

    const ecPayment = await initEasyCreditClient().createPayment(
      await mapCTCartToECPayment(cart, ctPayment, redirectLinks, customerRelationship),
    );

    const transactionState =
      ecPayment.transactionInformation.decision.decisionOutcome === ECTransactionDecision.NEGATIVE
        ? CTTransactionState.Failure
        : CTTransactionState.Initial;

    await updatePayment(ctPayment, [
      {
        action: 'addTransaction',
        transaction: {
          state: transactionState,
          type: CTTransactionType.Authorization,
          amount: cart.totalPrice,
          interactionId: ecPayment.transactionId,
          timestamp: new Date().toISOString(),
          custom: {
            type: {
              typeId: 'type',
              key: getTransactionCustomTypeKey(),
            },
            fields: {
              easyCreditTechnicalTransactionId: ecPayment.technicalTransactionId,
            },
          },
        },
      },
    ]);

    if (transactionState === CTTransactionState.Failure) {
      throw new MultiErrorx([
        new Errorx({
          code: 'TransactionNotSuccess',
          message: ecPayment.transactionInformation.decision.decisionOutcomeText,
          httpErrorStatus: 400,
        }),
      ]);
    }

    return mapCreatePaymentResponse(ecPayment, ctPayment);
  } catch (error: unknown) {
    log.error('Error in handleCreatePayment', error);

    if (!cart) {
      cart = await getCartById(cartId);
    }

    await unfreezeCartIfNoActivePayment(cart, newPaymentId);

    throw error;
  }
};

export const handleGetPayment = async (paymentId: string): Promise<GetPaymentResponse> => {
  try {
    const payment = await getPaymentById(paymentId);

    validatePayment(payment);
    validateTransaction(payment);

    const transaction = getTransaction(payment) as Transaction;
    const ecTechnicalTransactionId = transaction.custom?.fields.easyCreditTechnicalTransactionId as string;

    const ecPayment = await initEasyCreditClient().getPayment(ecTechnicalTransactionId);

    return {
      ...ecPayment,
      amount: convertCentsToEur(transaction.amount.centAmount, transaction.amount.fractionDigits),
      webShopId: readConfiguration().easyCredit.webShopId,
    };
  } catch (error: unknown) {
    log.error('Error in getting summary Payment', error);
    throw error;
  }
};

export const handleAuthorizeECPayment = async (paymentId: string): Promise<void> => {
  try {
    const payment = await getPaymentById(paymentId);

    validatePayment(payment);
    validateTransaction(payment);

    const transaction = getTransaction(payment) as Transaction;

    // The easyCredit transaction stays open after a cancel, so a stale easyCredit page can still reach this point.
    if (transaction.state === CTTransactionState.Failure) {
      throw new Errorx({
        code: 'TransactionCancelled',
        message: 'You are not allow to authorize a cancelled payment.',
        httpErrorStatus: 400,
      });
    }

    const ecTechnicalTransactionId = transaction.custom?.fields.easyCreditTechnicalTransactionId as string;

    const easyTransaction = await initEasyCreditClient().getPayment(ecTechnicalTransactionId);
    if (easyTransaction.status !== ECTransactionStatus.PREAUTHORIZED) {
      throw new Errorx({
        code: 'TransactionNotPreauthorized',
        message: 'You are not allow to authorize Easy Credit transaction without preauthorizing it first.',
        httpErrorStatus: 400,
      });
    }
    await initEasyCreditClient().authorizePayment(ecTechnicalTransactionId, paymentId);

    await updatePayment(payment, [
      { action: 'changeTransactionState', transactionId: transaction.id, state: CTTransactionState.Pending },
    ]);
  } catch (error: unknown) {
    log.error('Error in authorizing EasyCredit Payment', error);
    throw error;
  }
};

export const handleAuthorizePayment = async (paymentId: string): Promise<void> => {
  try {
    const payment = await getPaymentById(paymentId);

    validatePayment(payment);

    // Repeated authorization callback: already done.
    if (getSuccessTransaction(payment)) {
      return;
    }

    validatePendingTransaction(payment);

    const transaction = getPendingTransaction(payment) as Transaction;
    const ecTechnicalTransactionId = transaction.custom?.fields.easyCreditTechnicalTransactionId as string;

    const easyTransaction = await initEasyCreditClient().getPayment(ecTechnicalTransactionId);

    if (easyTransaction.status !== ECTransactionStatus.AUTHORIZED) {
      throw new Errorx({
        code: 'TransactionNotAuthorized',
        message: 'You are not allow to authorize a payment without EasyCredit Authorized transaction.',
        httpErrorStatus: 400,
      });
    }

    await updatePayment(payment, [
      { action: 'changeTransactionState', transactionId: transaction.id, state: CTTransactionState.Success },
    ]);
  } catch (error: unknown) {
    log.error('Error in authorizing CT Payment', error);
    throw error;
  }
};

// A cart can carry several payments (one per checkout attempt). Only unfreeze when none of the others is still in flight.
const unfreezeCartIfNoActivePayment = async (cart: Cart, paymentId?: string): Promise<void> => {
  if (cart.cartState !== CTCartState.Frozen) {
    return;
  }

  const otherPayments = await Promise.all(
    (cart.paymentInfo?.payments ?? []).filter((ref) => ref.id !== paymentId).map((ref) => getPaymentById(ref.id)),
  );

  const isActive = (payment: Payment) =>
    [CTTransactionState.Initial, CTTransactionState.Pending].includes(
      getTransaction(payment)?.state as CTTransactionState,
    );

  if (otherPayments.some((payment) => isEasyCreditPayment(payment) && isActive(payment))) {
    log.info('Cart stays frozen, another payment on it is still in progress', { cartId: cart.id, paymentId });
    return;
  }

  await updateCart(cart, [{ action: 'unfreezeCart' }]);
};

// A new checkout attempt replaces any easyCredit payment the shopper left at easyCredit without finishing or cancelling.
const supersedeInitialPayments = async (cart: Cart): Promise<void> => {
  const payments = await Promise.all((cart.paymentInfo?.payments ?? []).map((ref) => getPaymentById(ref.id)));

  for (const payment of payments) {
    const transaction = getTransaction(payment);

    if (isEasyCreditPayment(payment) && transaction?.state === CTTransactionState.Initial) {
      await updatePayment(payment, [
        { action: 'changeTransactionState', transactionId: transaction.id, state: CTTransactionState.Failure },
      ]);
    }
  }
};

// easyCredit stops finding a transaction about 30 minutes after the shopper's last action and answers with this error.
// An expired transaction can't be authorized anymore, so it is safe to cancel.
const isExpiredECTransactionError = (error: unknown): boolean => {
  const expired =
    error instanceof Errorx &&
    error.code === 'CONSTRAINT_VIOLATION' &&
    Array.isArray(error.fields) &&
    error.fields.some((violation: { field?: string }) => violation.field === 'decision');

  if (expired) {
    // Only seen in the sandbox so far; log so production confirms easyCredit uses it for expiry only.
    log.warn('easyCredit no longer finds the transaction, treating it as expired', { error });
  }

  return expired;
};

export const handleCancelPayment = async (paymentId: string): Promise<string> => {
  try {
    const payment = await getPaymentById(paymentId);

    validatePayment(payment);

    // Repeat hit from browser history or a stale easyCredit page: already cancelled, only finish a leftover unfreeze.
    if (getTransaction(payment)?.state === CTTransactionState.Failure) {
      // The redirect back to the shop matters more than this cleanup, so a failure here must not strand the shopper.
      await getCartByPaymentId(payment.id)
        .then((cart) => unfreezeCartIfNoActivePayment(cart, payment.id))
        .catch((error: unknown) =>
          log.warn('Could not finish cart unfreeze for cancelled payment', { paymentId, error }),
        );

      return paymentId;
    }

    const transaction = validateInitialOrPendingTransaction(payment);
    const ecTechnicalTransactionId = transaction.custom?.fields.easyCreditTechnicalTransactionId as string;

    const easyCreditTransaction = await initEasyCreditClient()
      .getPayment(ecTechnicalTransactionId)
      // Only an Initial transaction may be treated as expired; a Pending one may already be authorized at easyCredit.
      .catch((error: unknown) =>
        transaction.state === CTTransactionState.Initial && isExpiredECTransactionError(error)
          ? undefined
          : Promise.reject(error),
      );

    if (easyCreditTransaction?.status === ECTransactionStatus.AUTHORIZED) {
      throw new Errorx({
        code: 'TransactionIsAuthorized',
        message: 'You are not allow to cancel a payment with Easy Credit AUTHORIZED transaction.',
        httpErrorStatus: 400,
      });
    }

    await updatePayment(payment, [
      { action: 'changeTransactionState', transactionId: transaction.id, state: CTTransactionState.Failure },
    ]);
    await unfreezeCartIfNoActivePayment(await getCartByPaymentId(payment.id), payment.id);

    return paymentId;
  } catch (error) {
    log.error('Error in cancelling payment and unfreezing cart', error);
    throw error;
  }
};

export const handleCapturePayment = async (paymentId: string, trackingNumber?: string): Promise<void> => {
  try {
    const payment = await getPaymentById(paymentId);

    validatePayment(payment);
    validateSuccessTransaction(payment);

    const transaction = getSuccessTransaction(payment) as Transaction;
    const ecTechnicalTransactionId = transaction.custom?.fields.easyCreditTechnicalTransactionId as string;

    const easyCreditTransaction = await initEasyCreditClient().getPayment(ecTechnicalTransactionId);

    if (easyCreditTransaction.status !== ECTransactionStatus.AUTHORIZED) {
      throw new Errorx({
        code: 'TransactionIsNotAuthorized',
        message: 'You are not allow to capture a payment without Easy Credit AUTHORIZED transaction.',
        httpErrorStatus: 400,
      });
    }

    const response = await initEasyCreditClient().capturePayment(
      easyCreditTransaction.decision.transactionId,
      paymentId,
      trackingNumber,
    );

    if (response) {
      await updatePayment(payment, [
        {
          action: 'addTransaction',
          transaction: {
            type: CTTransactionType.Charge,
            state: CTTransactionState.Pending,
            amount: transaction.amount,
            interactionId: transaction.interactionId,
            timestamp: new Date().toISOString(),
            custom: transaction.custom,
          },
        },
      ]);
      log.info('Capture payment initiated successfully', { paymentId });
    }
  } catch (error) {
    log.error('Error in capturing payment', error);
    throw error;
  }
};

export const handleRefundPayment = async (paymentId: string, refundAmount: number): Promise<Payment> => {
  try {
    const payment = await getPaymentById(paymentId);

    validatePaymentAmount(payment, refundAmount);
    validatePayment(payment);
    validateSuccessTransaction(payment);

    const ecTransactionId = getSuccessTransaction(payment)?.interactionId as string;

    const updatedCTPayment = await updatePayment(payment, [
      {
        action: 'addTransaction',
        transaction: {
          type: CTTransactionType.Refund,
          state: CTTransactionState.Initial,
          amount: mapAmountToCTTransactionAmount(refundAmount),
        },
      },
    ]);

    const initialRefundTransaction = validateInitialRefundTransaction(updatedCTPayment);

    const refundPayload: ECRefundPayload = {
      value: refundAmount,
      bookingId: initialRefundTransaction.id,
    };

    const isSuccess = await initEasyCreditClient().refundPayment(ecTransactionId, refundPayload);

    let newState;
    if (isSuccess) {
      newState = CTTransactionState.Pending;
    } else {
      newState = CTTransactionState.Failure;
    }

    return await updatePayment(updatedCTPayment, [
      { action: 'changeTransactionState', transactionId: initialRefundTransaction.id, state: newState },
    ]);
  } catch (error) {
    log.error('Error in refunding payment', error);
    throw error;
  }
};
