import { Address, Cart, Errorx, MultiErrorx, Transaction } from '@commercetools/connect-payments-sdk';
import { getCartById, getCartByPaymentId, updateCart } from '../commercetools/cart.commercetools';
import { readConfiguration } from '../utils/config.utils';
import {
  CTCartState,
  CTTransactionState,
  CTTransactionType,
  ECCreatePaymentResponse,
  ECTransactionCustomerRelationship,
  ECTransactionDecision,
  ECTransactionRedirectLinksWithoutAuthorizationCallback,
  ECTransactionStatus,
  GetPaymentMethodResponse,
} from '../types/payment.types';
import { log } from '../libs/logger';
import {
  validateAddresses,
  validateCartAmount,
  validateCurrency,
  validatePayment,
  validatePendingTransaction,
} from '../validators/payment.validators';
import { createPayment, getPaymentById, updatePayment } from '../commercetools/payment.commercetools';
import { getPendingTransaction } from '../utils/payment.utils';
import { initEasyCreditClient } from '../client/easycredit.client';
import { mapCTCartToCTPayment, mapCTCartToECPayment } from '../utils/map.utils';
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

// Handle fetching and returning the payment method
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
): Promise<ECCreatePaymentResponse> => {
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
      ecPayment.transactionInformation.decision.decisionOutcome === ECTransactionDecision.POSITIVE
        ? CTTransactionState.Success
        : CTTransactionState.Failure;

    await updatePayment(ctPayment, [
      {
        action: 'addTransaction',
        transaction: {
          state: transactionState,
          type: CTTransactionType.Authorization,
          amount: cart.totalPrice,
          interactionId: ecPayment.transactionId,
        },
      },
    ]);

    if (transactionState === CTTransactionState.Failure) {
      await updateCart(cart, [{ action: 'unfreezeCart' }]);
    }

    return ecPayment;
  } catch (error: unknown) {
    log.error('Error in handleCreatePayment', error);

    if (cart) {
      await updateCart(cart, [{ action: 'unfreezeCart' }]);
    }

    throw error;
  }
};

// Handle payment authorization
export const handleAuthorizePayment = async (paymentId: string): Promise<void> => {
  try {
    const payment = await getPaymentById(paymentId);

    validatePayment(payment);
    validatePendingTransaction(payment);

    const transaction = getPendingTransaction(payment) as Transaction;
    const interactionId = transaction.interactionId as string;

    await initEasyCreditClient().authorizePayment(interactionId);

    await updatePayment(payment, [
      { action: 'changeTransactionState', transactionId: interactionId, state: 'Success' },
    ]);
  } catch (error: unknown) {
    log.error('Error in authorizing EasyCredit Payment', error);
    throw error;
  }
};

export const handleCancelPayment = async (paymentId: string): Promise<string> => {
  try {
    const payment = await getPaymentById(paymentId);

    validatePayment(payment);
    validatePendingTransaction(payment);

    const transaction = getPendingTransaction(payment) as Transaction;
    const interactionId = transaction.interactionId as string;

    const easyTransaction = await initEasyCreditClient().getPayment(transaction?.interactionId as string);

    if (easyTransaction.status !== ECTransactionStatus.FAILURE) {
      throw new Errorx({
        code: 'TransactionNotDeclined',
        message: 'Transaction status is not DECLINED.',
        httpErrorStatus: 400,
      });
    }

    await updatePayment(payment, [
      { action: 'changeTransactionState', transactionId: interactionId, state: 'Failure' },
    ]);
    const cart = await getCartByPaymentId(payment.id);

    await updateCart(cart, [{ action: 'unfreezeCart' }]);

    return paymentId;
  } catch (error) {
    log.error('Error in cancelling payment and unfreezing cart', error);
    throw error;
  }
};
