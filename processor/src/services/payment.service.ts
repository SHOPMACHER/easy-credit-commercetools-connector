import { Cart, Address, Errorx, MultiErrorx } from '@commercetools/connect-payments-sdk';
import { getCartById, unfreezeCartById } from '../commercetools/cart.commercetools';
import { readConfiguration } from '../utils/config.utils';
import { GetPaymentMethodResponse } from '../types/payment.types';
import { log } from '../libs/logger';
import {
  validateAddresses,
  validateCartAmount,
  validateCurrency,
  validatePayment,
  validatePendingTransaction,
} from '../validators/payment.validators';
import { getPaymentById, updatePaymentStatus } from '../commercetools/payment.commercetools';
import { getPendingTransaction } from '../utils/payment.utils';
import { initEasyCreditClient } from '../client/easycredit.client';

export const handlePaymentMethod = async (cartId: string): Promise<GetPaymentMethodResponse> => {
  try {
    const cart: Cart = await getCartById(cartId);
    const config = readConfiguration();
    const ecConfig = { webShopId: config.easyCredit.webShopId };
    const errors: Errorx[] = [];

    const billingAddress = cart.billingAddress as Address;
    const shippingAddress = cart.shippingAddress as Address;

    validateAddresses(billingAddress, shippingAddress, ecConfig, errors);
    validateCurrency(cart.totalPrice.currencyCode, ecConfig, errors);
    validateCartAmount(cart.totalPrice.centAmount, cart.totalPrice.fractionDigits, ecConfig, errors);

    if (errors.length > 0) {
      throw new MultiErrorx(errors);
    }

    return ecConfig;
  } catch (error: unknown) {
    log.error('Error in getting EasyCredit Payment Method', error);

    throw error;
  }
};

export const handleAuthorizePayment = async (paymentId: string): Promise<void> => {
  try {
    const payment = await getPaymentById(paymentId);

    validatePayment(payment);
    validatePendingTransaction(payment);

    await initEasyCreditClient().authorizePayment(getPendingTransaction(payment)?.interactionId as string);
  } catch (error: unknown) {
    log.error('Error in authorizing EasyCredit Payment', error);

    throw error;
  }
};

export const handleCancelPayment = async (paymentId: string): Promise<string> => {
  try {
    // Update the payment status to "Cancelled"
    await updatePaymentStatus(paymentId, 'Failure');

    await unfreezeCartById(paymentId);

    return paymentId;
  } catch (error) {
    log.error('Error in cancelling payment and unfreezing cart', error);
    throw error;
  }
};

export const handleDeniedPayment = async (paymentId: string): Promise<string> => {
  try {
    // Update the payment status to "Denied"
    await updatePaymentStatus(paymentId, 'Failure');

    // Unfreeze the cart associated with this payment
    await unfreezeCartById(paymentId);

    return paymentId;
  } catch (error) {
    log.error('Error in denying payment and unfreezing cart', error);
    throw error;
  }
};


