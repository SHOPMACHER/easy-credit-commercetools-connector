import {
  EASYCREDIT_CONNECTOR_KEY,
  EASYCREDIT_CONNECTOR_URL,
  EASYCREDIT_PAYMENT_METHOD,
  LIBRARY_NAME,
  VERSION_STRING,
} from './constant.utils';
import {
  ECCreatePaymentResponse,
  ECTransaction,
  ECTransactionCustomerRelationship,
  ECTransactionOrderDetailsShoppingCartInformation,
  ECTransactionPaymentType,
  ECTransactionRedirectLinksWithoutAuthorizationCallback,
  PaymentResponse,
} from '../types/payment.types';
import { Cart, LineItem, Payment, PaymentDraft } from '@commercetools/connect-payments-sdk';
import { convertCentsToEur } from './app.utils';
import { Address } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/common';
import { getCustomObjectByKey } from '../commercetools/customObject.commercetools';

const mapAddress = (address: Address) => ({
  address: address?.streetName ?? '',
  additionalAddressInformation: address?.additionalStreetInfo ?? '',
  zip: address?.postalCode ?? '',
  city: address?.city ?? '',
  country: address?.country ?? '',
  firstName: address?.firstName ?? '',
  lastName: address?.lastName ?? '',
});

const mapLineItem = (lineItem: LineItem) => ({
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

  return {
    orderDetails: {
      orderValue: convertCentsToEur(cart.totalPrice.centAmount, cart.totalPrice.fractionDigits),
      orderId: cart.id,
      numberOfProductsInShoppingCart: cart.lineItems.length,
      withoutFlexprice: false,
      invoiceAddress: mapAddress(cart.billingAddress as Address),
      shippingAddress: mapAddress(cart.shippingAddress as Address),
      shoppingCartInformation: cart.lineItems.map(mapLineItem) as ECTransactionOrderDetailsShoppingCartInformation[],
    },
    customer: {
      firstName: cart.shippingAddress?.firstName ?? cart.billingAddress?.firstName ?? '',
      lastName: cart.shippingAddress?.lastName ?? cart.billingAddress?.lastName ?? '',
    },
    shopsystem: {
      shopSystemManufacturer: LIBRARY_NAME,
      shopSystemModuleVersion: VERSION_STRING,
    },
    customerRelationship,
    redirectLinks: {
      urlDenial: `${connectorUrl?.value}/webhook/${payment.id}/cancel?redirectUrl=${redirectLinks.urlDenial}`,
      urlCancellation: `${connectorUrl?.value}/webhook/${payment.id}/cancel?redirectUrl=${redirectLinks.urlCancellation}`,
      urlSuccess: redirectLinks.urlSuccess,
      urlAuthorizationCallback: `${connectorUrl?.value}/webhook/${payment.id}/authorize`,
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
