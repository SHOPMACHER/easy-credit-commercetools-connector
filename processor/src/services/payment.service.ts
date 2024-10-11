import { Cart, Address, Errorx, MultiErrorx } from '@commercetools/connect-payments-sdk';
import { getCartById } from './../commercetools/cart.commercetools';
import { convertCentsToEur } from '../utils/app.utils';
import { MIN_CART_AMOUNT, MAX_CART_AMOUNT } from '../utils/constant.utils';
import { readConfiguration } from '../utils/config.utils';
import { GetPaymentMethodResponse } from '../types/payment.types';
import { log } from '../libs/logger';
import { compareAddress } from '../utils/commerceTools.utils';

export const handleGetEasyCreditPaymentMethod = async (cartId: string): Promise<GetPaymentMethodResponse> => {
  try {
    const cart: Cart = await getCartById(cartId);

    const config = readConfiguration();

    const ecConfig = {
      webShopId: config.easyCredit.webShopId,
    };

    const errors: Array<{ code: string; message: string }> = [];

    const cartBillingAddress = cart.billingAddress as Address;
    const cartShippingAddress = cart.shippingAddress as Address;

    if (!cartBillingAddress) {
      errors.push(
        new Errorx({
          code: 'InvalidBillingAddress',
          httpErrorStatus: 400,
          message: `Rechnungsadresse kann nicht gefunden werden.`,
          fields: ecConfig,
        }),
      );
    }

    if (!cartShippingAddress) {
      errors.push(
        new Errorx({
          code: 'InvalidShippingAddress',
          httpErrorStatus: 400,
          message: `Lieferadresse kann nicht gefunden werden.`,
          fields: ecConfig,
        }),
      );
    }

    if (
      !cartBillingAddress ||
      !cartShippingAddress ||
      compareAddress(cartBillingAddress, cartShippingAddress) === false ||
      cartBillingAddress.country !== 'DE'
    ) {
      errors.push(
        new Errorx({
          code: 'AddressesUnmatched',
          httpErrorStatus: 400,
          message: `Liefer- und Rechnungsadresse sind identisch und in Deutschland.`,
          fields: ecConfig,
        }),
      );
    }

    if (cart.totalPrice.currencyCode !== 'EUR') {
      errors.push(
        new Errorx({
          code: 'InvalidCurrency',
          httpErrorStatus: 400,
          message: `Die einzige verfügbare Währungsoption ist EUR.`,
          fields: ecConfig,
        }),
      );
    }

    const eurAmount = convertCentsToEur(cart.totalPrice.centAmount, cart.totalPrice.fractionDigits);

    if (eurAmount < MIN_CART_AMOUNT || eurAmount > MAX_CART_AMOUNT) {
      errors.push(
        new Errorx({
          code: 'InvalidAmount',
          httpErrorStatus: 400,
          message: `Summe des Warenkorbs beträgt zwischen ${MIN_CART_AMOUNT.toLocaleString()}€ und ${MAX_CART_AMOUNT.toLocaleString()}€.`,
          fields: ecConfig,
        }),
      );
    }

    if (errors.length > 0) {
      throw new MultiErrorx(errors as Errorx[]);
    }

    return ecConfig;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    log.error('Error in getting EasyCredit Payment Method', error);

    throw error;
  }
};
