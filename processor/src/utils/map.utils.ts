import {
  EASYCREDIT_BOOKING_STATUS_DONE,
  EASYCREDIT_BOOKING_STATUS_FAILED,
  EASYCREDIT_CONNECTOR_KEY,
  EASYCREDIT_CONNECTOR_URL,
  EASYCREDIT_EARLIER_CAPTURE_BOOKINGS_FIELD,
  EASYCREDIT_EXPRESS_FIELD,
  EASYCREDIT_EXPRESS_PLACEHOLDER_FIELD,
  EASYCREDIT_INTEREST_FIELD,
  EASYCREDIT_PAYMENT_METHOD,
  EASYCREDIT_PAYMENT_TYPE_LABELS,
  EASYCREDIT_TOTAL_VALUE_FIELD,
  getPaymentCustomTypeKey,
  getTransactionCustomTypeKey,
  LIBRARY_NAME,
  VERSION_STRING,
} from './constant.utils';
import { signRedirectUrl } from './redirectSignature.utils';
import {
  CTTransactionState,
  CTTransactionType,
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
import { convertCentsToEur, eurToCents } from './app.utils';
import { Address, Money } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/common';
import { getCustomObjectByKey } from '../commercetools/customObject.commercetools';
import { PaymentUpdateAction, TransactionDraft } from '@commercetools/platform-sdk';
import { readConfiguration } from './config.utils';
import { toPaymentMethod } from './payment.utils';

export const mapAddress = (address: Address) => ({
  address: [address?.streetName?.trim(), address?.streetNumber?.trim()].filter(Boolean).join(' '),
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

// The signature lets the webhook redirect only to a link the connector itself passed to easyCredit.
const cancelWebhookUrl = (connectorUrl: string | undefined, paymentId: string, redirectUrl: string): string =>
  `${connectorUrl}/webhook/${paymentId}/cancel?redirectUrl=${encodeURIComponent(redirectUrl)}` +
  `&sig=${signRedirectUrl(paymentId, redirectUrl)}`;

export type ExpressOptions = {
  express?: boolean;
};

export const mapCTCartToECPayment = async (
  cart: Cart,
  payment: Payment,
  redirectLinks: ECTransactionRedirectLinksWithoutAuthorizationCallback,
  customerRelationship: ECTransactionCustomerRelationship,
  paymentType: ECTransactionPaymentType = ECTransactionPaymentType.ECTransactionInstallmentPayment,
  { express = false }: ExpressOptions = {},
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
      // Express leaves customer and addresses out, the shopper enters them on the easyCredit payment page.
      ...(!express && {
        invoiceAddress: mapAddress(cart.billingAddress as Address),
        shippingAddress: mapAddress(shippingAddress as Address),
      }),
      shoppingCartInformation: cart.lineItems.map(mapLineItem) as ECTransactionOrderDetailsShoppingCartInformation[],
    },
    ...(!express && {
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
    }),
    shopsystem: {
      shopSystemManufacturer: LIBRARY_NAME,
      shopSystemModuleVersion: VERSION_STRING,
    },
    customerRelationship,
    redirectLinks: {
      urlDenial: cancelWebhookUrl(connectorUrlWithoutSplash, payment.id, redirectLinks.urlDenial),
      urlCancellation: cancelWebhookUrl(connectorUrlWithoutSplash, payment.id, redirectLinks.urlCancellation),
      urlSuccess: redirectLinks.urlSuccess,
      urlAuthorizationCallback: `${connectorUrlWithoutSplash}/webhook/${payment.id}/authorize`,
    },
    paymentType,
    // Offering the switch to bill payment on the easyCredit page needs bill payment to be enabled here.
    paymentSwitchPossible: readConfiguration().easyCredit.billPaymentEnabled === '1',
  };
};

export const mapCTCartToCTPayment = (
  cart: Cart,
  paymentType: ECTransactionPaymentType = ECTransactionPaymentType.ECTransactionInstallmentPayment,
  { express = false, placeholderAddress = false }: ExpressOptions & { placeholderAddress?: boolean } = {},
): PaymentDraft => ({
  amountPlanned: {
    currencyCode: cart.totalPrice.currencyCode,
    centAmount: cart.totalPrice.centAmount,
  },
  paymentMethodInfo: {
    paymentInterface: EASYCREDIT_PAYMENT_METHOD,
    method: toPaymentMethod(paymentType),
    name: { de: EASYCREDIT_PAYMENT_TYPE_LABELS[paymentType] },
  },
  ...(express && {
    custom: {
      type: { typeId: 'type', key: getPaymentCustomTypeKey() },
      fields: { [EASYCREDIT_EXPRESS_FIELD]: true, [EASYCREDIT_EXPRESS_PLACEHOLDER_FIELD]: placeholderAddress },
    },
  }),
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
  centAmount: eurToCents(amount),
  currencyCode: 'EUR',
});

export const mapPendingChargeTransaction = (
  authorization: Transaction,
  earlierCaptureBookings: string[] = [],
): TransactionDraft => {
  // The interest fields belong to the Authorization transaction only.
  const fields = Object.fromEntries(
    Object.entries(authorization.custom?.fields ?? {}).filter(
      ([name]) => name !== EASYCREDIT_INTEREST_FIELD && name !== EASYCREDIT_TOTAL_VALUE_FIELD,
    ),
  );
  if (earlierCaptureBookings.length > 0) {
    fields[EASYCREDIT_EARLIER_CAPTURE_BOOKINGS_FIELD] = earlierCaptureBookings;
  }
  const type = authorization.custom?.type ?? { typeId: 'type' as const, key: getTransactionCustomTypeKey() };

  return {
    type: CTTransactionType.Charge,
    state: CTTransactionState.Pending,
    amount: authorization.amount,
    interactionId: authorization.interactionId,
    timestamp: new Date().toISOString(),
    custom: authorization.custom || earlierCaptureBookings.length > 0 ? { type, fields } : undefined,
  };
};

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
      (ecRefund.status === EASYCREDIT_BOOKING_STATUS_DONE || ecRefund.status === EASYCREDIT_BOOKING_STATUS_FAILED)
    ) {
      updateActions.push({
        action: 'changeTransactionState',
        transactionId: ctRefundTransaction.id,
        state:
          ecRefund.status === EASYCREDIT_BOOKING_STATUS_DONE ? CTTransactionState.Success : CTTransactionState.Failure,
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

// Every address goods go to: all shipping addresses in Multiple mode, plus the item shipping addresses that items target.
export const getShippingDestinations = (cart: Cart): Address[] => {
  const shippingAddresses =
    cart.shippingMode === 'Multiple'
      ? cart.shipping.map(({ shippingAddress }) => shippingAddress)
      : [cart.shippingAddress];
  const targetedKeys = new Set(
    [...cart.lineItems, ...cart.customLineItems].flatMap(
      ({ shippingDetails }) => shippingDetails?.targets.map(({ addressKey }) => addressKey) ?? [],
    ),
  );
  const itemShippingAddresses = cart.itemShippingAddresses.filter(({ key }) => key && targetedKeys.has(key));

  return [...shippingAddresses, ...itemShippingAddresses].filter((address): address is Address => Boolean(address));
};
