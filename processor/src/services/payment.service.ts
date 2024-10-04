import { Cart } from '@commercetools/connect-payments-sdk';
import { getCartById } from './../commercetools/cart.commercetools';
import { convertCentsToEur } from '../utils/app.utils';
import { MIN_CART_AMOUNT, MAX_CART_AMOUNT } from '../utils/constant.utils';
import { readConfiguration } from '../utils/config.utils';
import { GetOptionResponse } from '../types/payment.types';

export const handleGetEasyCreditPaymentMethod = async (cartId: string): Promise<GetOptionResponse> => {
  const cart: Cart = await getCartById(cartId);

  const config = readConfiguration();

  const result = {
    webShopId: config.easyCredit.webShopId,
  };

  const errors: Array<{ code: string; message: string }> = [];

  if (
    cart?.billingAddress &&
    cart?.shippingAddress &&
    (cart.billingAddress.id !== cart.shippingAddress.id || cart?.billingAddress?.country !== 'DE')
  ) {
    errors.push({
      code: 'InvalidAddress',
      message: `Liefer- und Rechnungsadresse sind identisch und in Deutschland.`,
    });
  }

  if (cart.totalPrice.currencyCode !== 'EUR') {
    errors.push({
      code: 'InvalidAddress',
      message: `Die einzige verfügbare Währungsoption ist EUR.`,
    });
  }

  const eurAmount = convertCentsToEur(cart.totalPrice.centAmount, cart.totalPrice.fractionDigits);

  if (eurAmount < MIN_CART_AMOUNT || eurAmount > MAX_CART_AMOUNT) {
    errors.push({
      code: 'InvalidAmount',
      message: `Summe des Warenkorbs beträgt zwischen ${MIN_CART_AMOUNT.toLocaleString()}€ und ${MAX_CART_AMOUNT.toLocaleString()}€.`,
    });
  }

  return {
    success: errors ? true : false,
    ...result,
    errors,
  };
};
