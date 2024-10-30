import { Address, Cart, Errorx, MultiErrorx, Payment, Transaction } from '@commercetools/connect-payments-sdk';
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
  mapAmountToCTTransactionAmount,
  mapCreatePaymentResponse,
  mapCTCartToCTPayment,
  mapCTCartToECPayment,
} from '../utils/map.utils';
import { convertCentsToEur } from '../utils/app.utils';

// Helper to handle validation and return errors
const validateCart = (cart: Cart): Errorx[] => {
  const config = readConfiguration().easyCredit;
  const errors: Errorx[] = [];

  const billingAddress = cart.billingAddress as Address;
  const shippingAddress = cart.shippingAddress as Address;

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
  try {
    cart = await getCartById(cartId);
    const errors = validateCart(cart);

    if (errors.length > 0) {
      throw new MultiErrorx(errors);
    }

    if (cart.cartState !== CTCartState.Frozen) {
      cart = await updateCart(cart, [{ action: 'freezeCart' }]);
    }

    const ctPayment = await createPayment(mapCTCartToCTPayment(cart));
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
          interactionId: ecPayment.technicalTransactionId,
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

    await updateCart(cart, [{ action: 'unfreezeCart' }]);

    throw error;
  }
};

export const handleGetPayment = async (paymentId: string): Promise<GetPaymentResponse> => {
  try {
    const payment = await getPaymentById(paymentId);

    validatePayment(payment);
    validateTransaction(payment);

    const transaction = getTransaction(payment) as Transaction;
    const interactionId = transaction.interactionId as string;

    const ecPayment = await initEasyCreditClient().getPayment(interactionId);

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

export const handleAuthorizeECPayment = async (paymentId: string, orderId?: string): Promise<void> => {
  try {
    const payment = await getPaymentById(paymentId);

    validatePayment(payment);
    validateTransaction(payment);

    const transaction = getTransaction(payment) as Transaction;
    const interactionId = transaction.interactionId as string;

    const easyTransaction = await initEasyCreditClient().getPayment(interactionId);
    if (easyTransaction.status !== ECTransactionStatus.PREAUTHORIZED) {
      throw new Errorx({
        code: 'TransactionNotPreauthorized',
        message: 'You are not allow to authorize Easy Credit transaction without preauthorizing it first.',
        httpErrorStatus: 400,
      });
    }
    await initEasyCreditClient().authorizePayment(interactionId, orderId ?? paymentId);

    await updatePayment(payment, [
      { action: 'changeTransactionState', transactionId: interactionId, state: CTTransactionState.Pending },
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
    validatePendingTransaction(payment);

    const transaction = getPendingTransaction(payment) as Transaction;
    const interactionId = transaction.interactionId as string;

    const easyTransaction = await initEasyCreditClient().getPayment(interactionId);

    if (easyTransaction.status !== ECTransactionStatus.AUTHORIZED) {
      throw new Errorx({
        code: 'TransactionNotAuthorized',
        message: 'You are not allow to authorize a payment without EasyCredit Authorized transaction.',
        httpErrorStatus: 400,
      });
    }

    await updatePayment(payment, [
      { action: 'changeTransactionState', transactionId: interactionId, state: CTTransactionState.Success },
    ]);
  } catch (error: unknown) {
    log.error('Error in authorizing CT Payment', error);
    throw error;
  }
};

export const handleCancelPayment = async (paymentId: string): Promise<string> => {
  try {
    const payment = await getPaymentById(paymentId);

    validatePayment(payment);

    const transaction = validateInitialOrPendingTransaction(payment);

    const interactionId = transaction.interactionId as string;

    const easyCreditTransaction = await initEasyCreditClient().getPayment(interactionId);

    if (easyCreditTransaction.status === ECTransactionStatus.AUTHORIZED) {
      throw new Errorx({
        code: 'TransactionIsAuthorized',
        message: 'You are not allow to cancel a payment with Easy Credit AUTHORIZED transaction.',
        httpErrorStatus: 400,
      });
    }

    await updatePayment(payment, [
      { action: 'changeTransactionState', transactionId: transaction.id, state: CTTransactionState.Failure },
    ]);
    const cart = await getCartByPaymentId(payment.id);

    await updateCart(cart, [{ action: 'unfreezeCart' }]);

    return paymentId;
  } catch (error) {
    log.error('Error in cancelling payment and unfreezing cart', error);
    throw error;
  }
};

export const handleCapturePayment = async (
  paymentId: string,
  orderId?: string,
  trackingNumber?: string,
): Promise<void> => {
  try {
    const payment = await getPaymentById(paymentId);

    validatePayment(payment);
    validateSuccessTransaction(payment);

    const transaction = getSuccessTransaction(payment) as Transaction;
    const interactionId = transaction.interactionId as string;

    const easyCreditTransaction = await initEasyCreditClient().getPayment(interactionId);

    if (easyCreditTransaction.status !== ECTransactionStatus.AUTHORIZED) {
      throw new Errorx({
        code: 'TransactionIsNotAuthorized',
        message: 'You are not allow to capture a payment without Easy Credit AUTHORIZED transaction.',
        httpErrorStatus: 400,
      });
    }

    await initEasyCreditClient().capturePayment(
      easyCreditTransaction.decision.transactionId,
      orderId ?? paymentId,
      trackingNumber,
    );
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

    const ecTechnicalTransactionId = getSuccessTransaction(payment)?.interactionId;

    const ecTransaction = await initEasyCreditClient().getPayment(ecTechnicalTransactionId as string);

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

    const isSuccess = await initEasyCreditClient().refundPayment(ecTransaction.decision.transactionId, refundPayload);

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
