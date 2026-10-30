import { Address, Cart, Errorx, Payment, Transaction } from '@commercetools/connect-payments-sdk';
import { compareAddress } from '../utils/commerceTools.utils';
import { convertCentsToEur } from '../utils/app.utils';
import { EASYCREDIT_PAYMENT_METHOD } from '../utils/constant.utils';
import {
  getAddedTransaction,
  getPendingTransaction,
  getSuccessTransaction,
  getTransaction,
} from '../utils/payment.utils';
import { CTTransactionState, CTTransactionType, PaymentTypeAvailability } from '../types/payment.types';

const addressesUnmatchedError = (ecConfig: { webShopId: string }) =>
  new Errorx({
    code: 'AddressesUnmatched',
    httpErrorStatus: 400,
    message: 'Liefer- und Rechnungsadresse sind nicht identisch oder nicht in Deutschland.',
    fields: ecConfig,
  });

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
    errors.push(addressesUnmatchedError(ecConfig));
  }

  if (billingAddress && shippingAddress && !isBillingAddressComplete(billingAddress)) {
    errors.push(
      new Errorx({
        code: 'InvalidAddress',
        httpErrorStatus: 400,
        message: 'Die Adresse ist unvollständig oder ungültig.',
        fields: ecConfig,
      }),
    );
  }
};

const isBillingAddressComplete = (address: Address) =>
  [address.firstName, address.lastName, address.streetName, address.city].every((value) => !!value?.trim()) &&
  /^\d{5}$/.test(address.postalCode ?? '');

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

// Availability errors are expected on every checkout page load where a payment type is hidden, so they log at debug.
export const paymentTypeNotAvailableError = (ecConfig: { webShopId: string }) =>
  new Errorx({
    code: 'PaymentTypeNotAvailable',
    httpErrorStatus: 400,
    message: 'Die gewählte easyCredit-Zahlungsart ist für diesen Shop nicht verfügbar.',
    fields: ecConfig,
    skipLog: true,
  });

export const validatePaymentTypeAvailability = (
  amountInEur: number,
  availability: PaymentTypeAvailability,
  ecConfig: { webShopId: string },
  errors: Errorx[],
) => {
  if (availability.available) {
    return;
  }

  const { enabled, exclusion, minAmount, maxAmount } = availability;

  // Removing the item is the actionable fix, so it takes precedence over the amount limits.
  if (exclusion === 'cartItems') {
    errors.push(
      new Errorx({
        code: 'BillPaymentExcludedItems',
        httpErrorStatus: 400,
        message:
          'Die Zahlung per easyCredit-Rechnung ist für Gutscheine und andere nicht physische Artikel nicht möglich.',
        fields: ecConfig,
      }),
    );

    return;
  }

  // The amount limits would hide that the cart items could not be checked at all.
  if (exclusion === 'checkFailed') {
    errors.push(
      new Errorx({
        code: 'BillPaymentCheckFailed',
        httpErrorStatus: 503,
        message: 'Die Zahlung per easyCredit-Rechnung ist derzeit nicht verfügbar.',
        fields: ecConfig,
      }),
    );

    return;
  }

  // A disabled type stays unavailable at any amount, so its limits would only mislead the customer.
  if (
    enabled &&
    minAmount !== undefined &&
    maxAmount !== undefined &&
    (amountInEur < minAmount || amountInEur > maxAmount)
  ) {
    errors.push(
      new Errorx({
        code: 'InvalidAmount',
        httpErrorStatus: 400,
        message: `Die Summe des Warenkorbs muss zwischen ${minAmount.toLocaleString('de-DE')}€ und ${maxAmount.toLocaleString('de-DE')}€ liegen.`,
        fields: ecConfig,
        skipLog: true,
      }),
    );

    return;
  }

  errors.push(paymentTypeNotAvailableError(ecConfig));
};

// easyCredit bill payment is only offered to private persons.
export const validatePrivateCustomer = (
  cart: Cart,
  shippingDestinations: Address[],
  ecConfig: { webShopId: string },
  errors: Errorx[],
) => {
  const isCorporateCustomer =
    Boolean(cart.businessUnit) ||
    [cart.billingAddress, ...shippingDestinations].some((address) => Boolean(address?.company?.trim()));

  if (isCorporateCustomer) {
    errors.push(
      new Errorx({
        code: 'CorporateCustomerNotAllowed',
        httpErrorStatus: 400,
        message: 'Die Zahlung per easyCredit-Rechnung ist nur für Privatpersonen möglich.',
        fields: ecConfig,
      }),
    );
  }
};

// validateAddresses only compares the first destination, bill payment requires all of them to match the billing address.
export const validateShippingDestinations = (
  billingAddress: Address | undefined,
  shippingDestinations: Address[],
  ecConfig: { webShopId: string },
  errors: Errorx[],
) => {
  if (!billingAddress || errors.some(({ code }) => code === 'AddressesUnmatched')) {
    return;
  }

  if (shippingDestinations.some((address) => !compareAddress(billingAddress, address))) {
    errors.push(addressesUnmatchedError(ecConfig));
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

export const validateInitialRefundTransaction = (before: Payment, after: Payment): Transaction => {
  const transaction = getAddedTransaction(before, after, CTTransactionType.Refund, CTTransactionState.Initial);

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
