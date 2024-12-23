import { Address, Errorx, Payment, Transaction } from '@commercetools/connect-payments-sdk';
import { compareAddress } from '../utils/commerceTools.utils';
import { convertCentsToEur } from '../utils/app.utils';
import { EASYCREDIT_PAYMENT_METHOD, MAX_CART_AMOUNT, MIN_CART_AMOUNT } from '../utils/constant.utils';
import {
  getInitialRefundTransaction,
  getPendingTransaction,
  getSuccessTransaction,
  getTransaction,
} from '../utils/payment.utils';
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

export const validateSuccessTransaction = (payment: Payment) => {
  const successTransaction = getSuccessTransaction(payment);

  if (!successTransaction?.interactionId) {
    throw new Errorx({
      code: 'InvalidPaymentTransaction',
      httpErrorStatus: 400,
      message: 'Missing success transaction',
    });
  }
};

export const validateInitialOrPendingTransaction = (payment: Payment): Transaction => {
  let validTransaction;

  for (const transaction of payment.transactions) {
    if (
      transaction.type === CTTransactionType.Authorization &&
      (transaction.state === CTTransactionState.Initial || transaction.state === CTTransactionState.Pending) &&
      transaction.interactionId
    ) {
      validTransaction = transaction;

      break;
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

export const validateInitialRefundTransaction = (payment: Payment): Transaction => {
  const transaction = getInitialRefundTransaction(payment);

  if (!transaction) {
    throw new Errorx({
      code: 'InvalidPaymentTransaction',
      httpErrorStatus: 400,
      message: 'Missing initial refund transaction',
    });
  }

  return transaction;
};

export const validatePaymentAmount = (payment: Payment, refundAmount: number): void => {
  const { centAmount, fractionDigits } = payment.amountPlanned;

  const amountInEur = convertCentsToEur(centAmount, fractionDigits);

  if (refundAmount > amountInEur || refundAmount <= 0) {
    throw new Errorx({
      code: 'InvalidRefundAmount',
      httpErrorStatus: 400,
      message: 'The refund amount cannot be greater than the payment amount and must be greater than 0',
    });
  }
};

export const validateECTransactionId = (transactionId: string) => {
  if (!/^[A-Z0-9]{6}$/.test(transactionId)) {
    throw new Errorx({
      code: 'InvalidResourceId',
      message: 'Invalid transaction ID format.',
      httpErrorStatus: 400,
    });
  }
};
