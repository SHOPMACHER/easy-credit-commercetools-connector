import { Address, Errorx, Payment, Transaction } from '@commercetools/connect-payments-sdk';
import { compareAddress } from '../utils/commerceTools.utils';
import { convertCentsToEur } from '../utils/app.utils';
import { EASYCREDIT_PAYMENT_METHOD, MAX_CART_AMOUNT, MIN_CART_AMOUNT } from '../utils/constant.utils';
import { getPendingTransaction, getTransaction } from '../utils/payment.utils';
import { CTTransactionState, CTTransactionType } from '../types/payment.types';

export const validateAddresses = (
  billingAddress: Address | undefined,
  shippingAddress: Address | undefined,
  ecConfig: { webShopId: string },
  errors: Errorx[],
) => {
  if (!billingAddress) {
    errors.push(
      new Errorx({
        code: 'InvalidBillingAddress',
        httpErrorStatus: 400,
        message: 'Rechnungsadresse kann nicht gefunden werden.',
        fields: ecConfig,
      }),
    );
  }

  if (!shippingAddress) {
    errors.push(
      new Errorx({
        code: 'InvalidShippingAddress',
        httpErrorStatus: 400,
        message: 'Lieferadresse kann nicht gefunden werden.',
        fields: ecConfig,
      }),
    );
  }

  if (
    !billingAddress ||
    !shippingAddress ||
    !compareAddress(billingAddress, shippingAddress) ||
    billingAddress.country !== 'DE'
  ) {
    errors.push(
      new Errorx({
        code: 'AddressesUnmatched',
        httpErrorStatus: 400,
        message: 'Liefer- und Rechnungsadresse sind nicht identisch oder nicht in Deutschland.',
        fields: ecConfig,
      }),
    );
  }
};

export const validateCurrency = (currencyCode: string, ecConfig: { webShopId: string }, errors: Errorx[]) => {
  if (currencyCode !== 'EUR') {
    errors.push(
      new Errorx({
        code: 'InvalidCurrency',
        httpErrorStatus: 400,
        message: 'Die einzige verfügbare Währungsoption ist EUR.',
        fields: ecConfig,
      }),
    );
  }
};

export const validateCartAmount = (
  centAmount: number,
  fractionDigits: number,
  ecConfig: { webShopId: string },
  errors: Errorx[],
) => {
  const amountInEur = convertCentsToEur(centAmount, fractionDigits);

  if (amountInEur < MIN_CART_AMOUNT || amountInEur > MAX_CART_AMOUNT) {
    errors.push(
      new Errorx({
        code: 'InvalidAmount',
        httpErrorStatus: 400,
        message: `Die Summe des Warenkorbs muss zwischen ${MIN_CART_AMOUNT.toLocaleString()}€ und ${MAX_CART_AMOUNT.toLocaleString()}€ liegen.`,
        fields: ecConfig,
      }),
    );
  }
};

export const validatePayment = (payment: Payment) => {
  if (
    !payment.paymentMethodInfo?.paymentInterface ||
    payment.paymentMethodInfo?.paymentInterface.toLowerCase() !== EASYCREDIT_PAYMENT_METHOD
  ) {
    throw new Errorx({
      code: 'InvalidPaymentMethod',
      httpErrorStatus: 400,
      message: 'Invalid payment method',
    });
  }
};

export const validatePendingTransaction = (payment: Payment) => {
  const pendingTransaction = getPendingTransaction(payment);

  if (!pendingTransaction?.interactionId) {
    throw new Errorx({
      code: 'InvalidPaymentTransaction',
      httpErrorStatus: 400,
      message: 'Missing pending transaction',
    });
  }
};

export const validateInitialOrPendingTransaction = (payment: Payment): Transaction => {
  let validTransaction;

  for (let i = 0; i < payment.transactions.length; i++) {
    if (
      payment.transactions[i].type === CTTransactionType.Authorization &&
      (payment.transactions[i].state === CTTransactionState.Initial ||
        payment.transactions[i].state === CTTransactionState.Pending) &&
      payment.transactions[i].interactionId
    ) {
      validTransaction = payment.transactions[i];
    }
  }

  if (!validTransaction) {
    throw new Errorx({
      code: 'InvalidPaymentTransaction',
      httpErrorStatus: 400,
      message: 'No interactionId found in any initial or pending transaction',
    });
  }

  return validTransaction;
};

export const validateTransaction = (payment: Payment) => {
  const transaction = getTransaction(payment);

  if (!transaction?.interactionId) {
    throw new Errorx({
      code: 'InvalidPaymentTransaction',
      httpErrorStatus: 400,
      message: 'Missing transaction',
    });
  }
};
