import {
  EASYCREDIT_CONNECTOR_KEY,
  EASYCREDIT_CONNECTOR_URL,
  EASYCREDIT_PAYMENT_METHOD,
  EASYCREDIT_REFUND_STATUS_DONE,
  EASYCREDIT_REFUND_STATUS_FAILED,
  LIBRARY_NAME,
  VERSION_STRING,
} from './constant.utils';
import {
  CTTransactionState,
  ECBooking,
  ECCreatePaymentResponse,
  ECTransaction,
  ECTransactionCustomerRelationship,
  ECTransactionOrderDetailsShoppingCartInformation,
  ECTransactionPaymentType,
  ECTransactionRedirectLinksWithoutAuthorizationCallback,
  PaymentResponse,
} from '../types/payment.types';
import { Cart, LineItem, Payment, PaymentDraft, Transaction } from '@commercetools/connect-payments-sdk';
import { convertCentsToEur } from './app.utils';
import { Address, Money } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/common';
import { getCustomObjectByKey } from '../commercetools/customObject.commercetools';
import { PaymentUpdateAction } from '@commercetools/platform-sdk';

export const mapAddress = (address: Address) => ({
  address: (address?.streetName ?? '') + ' ' + (address?.streetNumber ?? ''),
  additionalAddressInformation: address?.additionalStreetInfo ?? '',
  zip: address?.postalCode ?? '',
  city: address?.city ?? '',
  country: address?.country ?? '',
  firstName: address?.firstName ?? '',
  lastName: address?.lastName ?? '',
});

export const mapLineItem = (lineItem: LineItem) => ({
  productName: lineItem.name.de ?? lineItem.name['de-DE'], // Assuming the name is in German
  quantity: lineItem.quantity,
  price: convertCentsToEur(lineItem.price.value.centAmount, lineItem.price.value.fractionDigits),
  articleNumber: [
    {
      numberType: 'GTIN',
      number: lineItem.variant.sku,
    },
  ],
});

export const mapCTCartToECPayment = async (
  cart: Cart,
  payment: Payment,
  redirectLinks: ECTransactionRedirectLinksWithoutAuthorizationCallback,
  customerRelationship: ECTransactionCustomerRelationship,
): Promise<ECTransaction> => {
  const connectorUrl = await getCustomObjectByKey(EASYCREDIT_CONNECTOR_KEY, EASYCREDIT_CONNECTOR_URL);

  const connectorUrlWithoutSplash = connectorUrl?.value.endsWith('/')
    ? connectorUrl?.value.slice(0, -1)
    : connectorUrl?.value;

  const shippingAddress = getShippingAddress(cart);

  return {
    orderDetails: {
      orderValue: convertCentsToEur(cart.totalPrice.centAmount, cart.totalPrice.fractionDigits),
      orderId: payment.id,
      numberOfProductsInShoppingCart: cart.lineItems.length,
      withoutFlexprice: false,
      invoiceAddress: mapAddress(cart.billingAddress as Address),
      shippingAddress: mapAddress(shippingAddress as Address),
      shoppingCartInformation: cart.lineItems.map(mapLineItem) as ECTransactionOrderDetailsShoppingCartInformation[],
    },
    customer: {
      firstName: shippingAddress?.firstName ?? cart.billingAddress?.firstName ?? '',
      lastName: shippingAddress?.lastName ?? cart.billingAddress?.lastName ?? '',
      contact: {
        email: cart?.customerEmail ?? '',
        mobilePhoneNumber: shippingAddress?.phone ?? cart.billingAddress?.phone ?? '',
        phoneNumber: shippingAddress?.phone ?? cart.billingAddress?.phone ?? '',
        phoneNumbersConfirmed: true,
      },
    },
    shopsystem: {
      shopSystemManufacturer: LIBRARY_NAME,
      shopSystemModuleVersion: VERSION_STRING,
    },
    customerRelationship,
    redirectLinks: {
      urlDenial: `${connectorUrlWithoutSplash}/webhook/${payment.id}/cancel?redirectUrl=${encodeURIComponent(redirectLinks.urlDenial)}`,
      urlCancellation: `${connectorUrlWithoutSplash}/webhook/${payment.id}/cancel?redirectUrl=${encodeURIComponent(redirectLinks.urlCancellation)}`,
      urlSuccess: redirectLinks.urlSuccess,
      urlAuthorizationCallback: `${connectorUrlWithoutSplash}/webhook/${payment.id}/authorize`,
    },
    paymentType: ECTransactionPaymentType.ECTransactionInstallmentPayment,
    paymentSwitchPossible: false,
  };
};

export const mapCTCartToCTPayment = (cart: Cart): PaymentDraft => ({
  amountPlanned: {
    currencyCode: cart.totalPrice.currencyCode,
    centAmount: cart.totalPrice.centAmount,
  },
  paymentMethodInfo: {
    paymentInterface: EASYCREDIT_PAYMENT_METHOD,
    method: EASYCREDIT_PAYMENT_METHOD,
  },
});

export const mapCreatePaymentResponse = (ecPayment: ECCreatePaymentResponse, payment: Payment): PaymentResponse => ({
  technicalTransactionId: ecPayment.technicalTransactionId,
  paymentId: payment.id,
  redirectUrl: ecPayment.redirectUrl,
  transactionInformation: {
    status: ecPayment.transactionInformation.status,
    decision: {
      decisionOutcome: ecPayment.transactionInformation.decision.decisionOutcome,
      decisionOutcomeText: ecPayment.transactionInformation.decision.decisionOutcomeText,
    },
  },
});

export const mapAmountToCTTransactionAmount = (amount: number): Money => ({
  centAmount: Math.floor(amount * 100),
  currencyCode: 'EUR',
});

export const mapUpdateActionForRefunds = (
  ctPendingRefunds: Transaction[],
  ecCompletedRefunds: ECBooking[],
): PaymentUpdateAction[] => {
  const ecRefundMap = new Map(ecCompletedRefunds.map((item) => [item?.bookingId, item]));

  const updateActions = [];

  for (const ctRefundTransaction of ctPendingRefunds) {
    const ecRefund = ecRefundMap.get(ctRefundTransaction.id);

    if (
      ecRefund &&
      (ecRefund.status === EASYCREDIT_REFUND_STATUS_DONE || ecRefund.status === EASYCREDIT_REFUND_STATUS_FAILED)
    ) {
      updateActions.push({
        action: 'changeTransactionState',
        transactionId: ctRefundTransaction.id,
        state:
          ecRefund.status === EASYCREDIT_REFUND_STATUS_DONE ? CTTransactionState.Success : CTTransactionState.Failure,
      });
    }
  }

  return updateActions as PaymentUpdateAction[];
};

export const getShippingAddress = (cart: Cart): Address | undefined => {
  if (cart.shippingMode === 'Multiple') {
    // Safely access first shipping address
    return cart.shipping?.[0]?.shippingAddress;
  }
  return cart.shippingAddress;
};
