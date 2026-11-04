import {
  Cart,
  ErrorInvalidField,
  Errorx,
  MultiErrorx,
  Payment,
  Transaction,
} from '@commercetools/connect-payments-sdk';
import { findCartByPaymentId, getCartById, getCartByPaymentId, updateCart } from '../commercetools/cart.commercetools';
import { isPaymentCustomTypeReady } from '../commercetools/customFields.commercetools';
import { readConfiguration } from '../utils/config.utils';

import {
  CTCartState,
  CTTransactionState,
  CTTransactionType,
  ECGetMerchantTransactionResponse,
  ECGetPaymentResponse,
  ECRefundPayload,
  ECTransactionCustomerRelationship,
  ECTransactionDecision,
  ECTransactionPaymentType,
  ECTransactionRedirectLinksWithoutAuthorizationCallback,
  ECTransactionStatus,
  GetPaymentMethodResponse,
  GetPaymentResponse,
  PaymentResponse,
  PaymentTypeExclusion,
  PaymentTypesAvailability,
} from '../types/payment.types';
import { PaymentUpdateAction } from '@commercetools/platform-sdk';
import { CartUpdateAction } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/cart';
import { log } from '../libs/logger';
import {
  paymentTypeNotAvailableError,
  validateAddresses,
  validateCurrency,
  validateInitialOrPendingTransaction,
  validateInitialRefundTransaction,
  validatePayment,
  validatePaymentTypeAvailability,
  validatePrivateCustomer,
  validateRefundAmountFormat,
  validateRefundAmountLeft,
  validateShippingDestinations,
  validateSuccessTransaction,
  validateTransaction,
} from '../validators/payment.validators';
import { createPayment, getPaymentById, updatePayment } from '../commercetools/payment.commercetools';
import {
  getActiveCaptureTransaction,
  getAddedTransaction,
  getCaptureBooking,
  getCaptureResult,
  getChargeCaptureBookings,
  getOpenRefundTransactions,
  getPaymentType,
  getPendingCaptureTransactions,
  getSuccessCaptureTransactions,
  getSuccessTransaction,
  getTransaction,
  isCaptureInFlight,
  toPaymentMethod,
} from '../utils/payment.utils';
import { initEasyCreditClient } from '../client/easycredit.client';
import { ECOutcomeUnknownError } from '../client/easycredit.errors';
import {
  ExpressOptions,
  getShippingAddress,
  getShippingDestinations,
  mapAmountToCTTransactionAmount,
  mapCreatePaymentResponse,
  mapCTCartToCTPayment,
  mapCTCartToECPayment,
  mapPendingChargeTransaction,
} from '../utils/map.utils';
import { convertCentsToEur, eurToCents } from '../utils/app.utils';
import {
  EASYCREDIT_AUTHORIZATION_POLL_INTERVAL_MS,
  EASYCREDIT_AUTHORIZATION_TIMEOUT_MS,
  EASYCREDIT_BOOKING_STATUS_DONE,
  EASYCREDIT_CALLBACK_LOOKUP_TIMEOUT_MS,
  EASYCREDIT_CAPTURE_NOT_REPORTED_STATUSES,
  EASYCREDIT_EXPRESS_FIELD,
  EASYCREDIT_EXPRESS_PLACEHOLDER_FIELD,
  EASYCREDIT_INTEREST_FIELD,
  EASYCREDIT_PAYMENT_METHOD,
  EASYCREDIT_PAYMENT_TYPE_LABELS,
  EASYCREDIT_REQUEST_TIMEOUT_MS,
  EASYCREDIT_TOTAL_VALUE_FIELD,
  EXPRESS_PLACEHOLDER_COUNTRY,
  getPaymentCustomTypeKey,
  getTransactionCustomTypeKey,
} from '../utils/constant.utils';
import { getPaymentTypesAvailability } from './webshop.service';
import { getBillPaymentExclusion } from './billPaymentRestriction.service';
import { settleOpenRefunds } from './easycreditNotification.service';
import { getCustomerRelationship } from './customerRelationship.service';

// Callers that omit a type stay on installment.
const DEFAULT_PAYMENT_TYPE = ECTransactionPaymentType.ECTransactionInstallmentPayment;

// Bill payment is for physical goods only; a failed product type lookup keeps it closed.
const applyBillPaymentExclusion = async (
  cart: Cart,
  paymentTypes: PaymentTypesAvailability,
): Promise<PaymentTypesAvailability> => {
  const bill = paymentTypes[ECTransactionPaymentType.ECTransactionBillPayment];

  if (!bill.enabled) {
    return paymentTypes;
  }

  const withUnavailableBill = (exclusion: PaymentTypeExclusion): PaymentTypesAvailability => ({
    ...paymentTypes,
    [ECTransactionPaymentType.ECTransactionBillPayment]: { ...bill, available: false, exclusion },
  });

  try {
    const { productTypeKeys, customLineItems } = await getBillPaymentExclusion(cart);

    if (productTypeKeys.length === 0 && customLineItems.length === 0) {
      return paymentTypes;
    }

    log.info('Bill payment is excluded for the cart items', { cartId: cart.id, productTypeKeys, customLineItems });

    return withUnavailableBill('cartItems');
  } catch (error: unknown) {
    log.error(`Failed to check the items of cart ${cart.id} for bill payment, bill payment is not offered`, error);

    return withUnavailableBill('checkFailed');
  }
};

// Checked before the cart is read, so a deployment with bill payment switched off never loads the cart for it.
const assertPaymentTypeEnabled = (paymentType: ECTransactionPaymentType) => {
  const { webShopId, billPaymentEnabled } = readConfiguration().easyCredit;

  if (paymentType === ECTransactionPaymentType.ECTransactionBillPayment && billPaymentEnabled !== '1') {
    throw new MultiErrorx([paymentTypeNotAvailableError({ webShopId })]);
  }
};

// Express skips the address checks: the address comes from easyCredit after the payment page.
const collectCartDataErrors = (
  cart: Cart,
  paymentType: ECTransactionPaymentType,
  ecConfig: { webShopId: string },
  errors: Errorx[],
  { express = false }: ExpressOptions = {},
) => {
  if (!express) {
    validateAddresses(cart.billingAddress, getShippingAddress(cart), ecConfig, errors);
  } else if (cart.shippingMode === 'Multiple') {
    // easyCredit returns one address, and commercetools cannot freeze a Multiple cart without item shipping details.
    errors.push(
      new Errorx({
        code: 'ExpressShippingModeNotSupported',
        httpErrorStatus: 400,
        message: 'Der Express-Checkout unterstützt keine Lieferung an mehrere Adressen.',
        fields: ecConfig,
      }),
    );
  }
  validateCurrency(cart.totalPrice.currencyCode, ecConfig, errors);

  if (paymentType === ECTransactionPaymentType.ECTransactionBillPayment) {
    const shippingDestinations = express ? [] : getShippingDestinations(cart);

    if (!express) {
      validateShippingDestinations(cart.billingAddress, shippingDestinations, ecConfig, errors);
    }
    validatePrivateCustomer(cart, shippingDestinations, ecConfig, errors);
  }
};

const validateCartData = (cart: Cart, paymentType: ECTransactionPaymentType, ecConfig: { webShopId: string }) => {
  const errors: Errorx[] = [];

  collectCartDataErrors(cart, paymentType, ecConfig, errors);

  if (errors.length > 0) {
    throw new MultiErrorx(errors);
  }
};

// Throws a MultiErrorx with all cart and availability errors if easyCredit cannot be offered for the cart.
// The enabler hides a payment type if any of them is an availability error, so the order does not matter.
const validateCart = async (
  cart: Cart,
  paymentType: ECTransactionPaymentType,
  options: ExpressOptions = {},
): Promise<PaymentTypesAvailability> => {
  const ecConfig = { webShopId: readConfiguration().easyCredit.webShopId };
  const amount = convertCentsToEur(cart.totalPrice.centAmount, cart.totalPrice.fractionDigits);
  const availability = await getPaymentTypesAvailability(amount);
  // Installment requests skip the product type lookup; handlePaymentMethod applies it for the response.
  const paymentTypes =
    paymentType === ECTransactionPaymentType.ECTransactionBillPayment
      ? await applyBillPaymentExclusion(cart, availability)
      : availability;
  const availabilityErrors: Errorx[] = [];

  validatePaymentTypeAvailability(amount, paymentTypes[paymentType], ecConfig, availabilityErrors);

  // The response takes its status from the first error, so a 503 cannot share the list with the cart's 400s.
  if (availabilityErrors.some(({ httpErrorStatus }) => httpErrorStatus !== 400)) {
    throw new MultiErrorx(availabilityErrors);
  }

  const errors: Errorx[] = [];

  collectCartDataErrors(cart, paymentType, ecConfig, errors, options);
  errors.push(...availabilityErrors);

  if (errors.length > 0) {
    throw new MultiErrorx(errors);
  }

  return paymentTypes;
};

const REDIRECT_LINK_KEYS = ['urlSuccess', 'urlCancellation', 'urlDenial'] as const;

// The shopper lands on these links, so only plain absolute web links: no other scheme and no credentials, which would
// make https://shop.example.com@evil.example open evil.example.
const assertRedirectLinks = (redirectLinks: ECTransactionRedirectLinksWithoutAuthorizationCallback): void => {
  for (const key of REDIRECT_LINK_KEYS) {
    const value = redirectLinks[key];
    const url = URL.canParse(value) ? new URL(value) : undefined;

    if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new ErrorInvalidField(
        `redirectLinks.${key}`,
        value,
        'absolute http or https URL without user name or password',
      );
    }
  }
};

const assertSessionCart = (cartId: string | undefined): string => {
  if (!cartId) {
    throw new Errorx({
      code: 'InvalidSession',
      message: 'The session has no cart.',
      httpErrorStatus: 400,
    });
  }

  return cartId;
};

// Without the payment custom type the express payment cannot be flagged, so express is refused before the cart changes.
const assertExpressConfigured = async (): Promise<void> => {
  const typeKey = getPaymentCustomTypeKey();

  if (!(await isPaymentCustomTypeReady(typeKey))) {
    throw new Errorx({
      code: 'ExpressNotConfigured',
      message: 'Der Express-Checkout ist nicht eingerichtet.',
      privateMessage: `The payment custom type "${typeKey}" is missing or incomplete, redeploy the connector to create it`,
      httpErrorStatus: 503,
    });
  }
};

const isExpressPayment = (payment: Payment): boolean => payment.custom?.fields?.[EASYCREDIT_EXPRESS_FIELD] === true;

const ownsPlaceholderAddress = (payment: Payment): boolean =>
  payment.custom?.fields?.[EASYCREDIT_EXPRESS_PLACEHOLDER_FIELD] === true;

// Only the country is set: anything else means the shop or the express return replaced the placeholder.
const isPlaceholderAddress = (address: Cart['shippingAddress']): boolean =>
  !!address &&
  address.country === EXPRESS_PLACEHOLDER_COUNTRY &&
  Object.entries(address).every(([field, value]) => field === 'country' || value === undefined || value === '');

// Puts the cart back to its state before the attempt: unfrozen and, if the connector added it, without the placeholder.
// A shipping method blocks unsetting the address; without an address before the attempt the shopper can only have set it on the placeholder.
const releaseCartActions = (cart: Cart, ownsPlaceholder: boolean): CartUpdateAction[] => {
  const removePlaceholder = ownsPlaceholder && isPlaceholderAddress(cart.shippingAddress);

  return [
    ...(cart.cartState === CTCartState.Frozen ? [{ action: 'unfreezeCart' as const }] : []),
    ...(removePlaceholder && cart.shippingInfo ? [{ action: 'setShippingMethod' as const }] : []),
    ...(removePlaceholder ? [{ action: 'setShippingAddress' as const }] : []),
  ];
};

const releaseCart = async (cart: Cart, ownsPlaceholder: boolean): Promise<void> => {
  const actions = releaseCartActions(cart, ownsPlaceholder);

  if (actions.length > 0) {
    await updateCart(cart, actions);
  }
};

const isEasyCreditPayment = (payment: Payment): boolean =>
  payment.paymentMethodInfo.paymentInterface?.toLowerCase() === EASYCREDIT_PAYMENT_METHOD;

const isOpenAttempt = (payment: Payment): boolean => {
  const state = getTransaction(payment)?.state;
  return state === CTTransactionState.Initial || state === CTTransactionState.Pending;
};

// The attempt is over. Its cart stays frozen while another easyCredit attempt on it is open, as that one owns the freeze.
// Safe to repeat, so a retry after a failed release frees the cart. A discarded attempt is on no cart any more.
const releaseCartOfEndedAttempt = async (payment: Payment): Promise<void> => {
  const cart = await findCartByPaymentId(payment.id);

  if (!cart) {
    return;
  }

  for (const { id } of cart.paymentInfo?.payments ?? []) {
    if (id !== payment.id) {
      const other = await getPaymentById(id);

      if (isEasyCreditPayment(other) && isOpenAttempt(other)) {
        return;
      }
    }
  }

  await releaseCart(cart, ownsPlaceholderAddress(payment));
};

// An express attempt left without a callback keeps the cart frozen with the placeholder, which the regular address checks
// reject. The regular flow ends it first. An attempt that easyCredit may still authorize throws PaymentInProgress.
const releaseAbandonedExpressAttempts = async (cart: Cart): Promise<Cart> => {
  if (!isPlaceholderAddress(cart.shippingAddress)) {
    return cart;
  }

  const owners: Payment[] = [];

  for (const { id } of cart.paymentInfo?.payments ?? []) {
    const payment = await getPaymentById(id);

    if (isEasyCreditPayment(payment) && ownsPlaceholderAddress(payment)) {
      owners.push(payment);
    }
  }

  if (owners.length === 0) {
    return cart;
  }

  for (const owner of owners) {
    if (
      (await isStaleAttempt(owner)) &&
      !(await setTransactionState(owner.id, CTTransactionState.Failure, CTTransactionState.Initial))
    ) {
      throw paymentInProgressError();
    }
  }

  log.info('Ended an abandoned express attempt before the regular checkout', {
    cartId: cart.id,
    paymentIds: owners.map(({ id }) => id),
  });

  return updateCart(cart, [
    ...releaseCartActions(cart, true),
    ...owners.map(({ id }) => ({ action: 'removePayment' as const, payment: { typeId: 'payment' as const, id } })),
  ]);
};

// The availability check must not fail on a cleanup it could not do; the address check then reports the placeholder.
const releaseAbandonedExpressAttemptsQuietly = async (cart: Cart): Promise<Cart> => {
  try {
    return await releaseAbandonedExpressAttempts(cart);
  } catch (error: unknown) {
    log.warn('Could not end the abandoned express attempt of the cart', { cartId: cart.id, error });
    return cart;
  }
};

const expressAddressMissingError = () =>
  new Errorx({
    code: 'ExpressAddressMissing',
    message: 'Die Adresse aus dem easyCredit Express-Checkout fehlt im Warenkorb.',
    httpErrorStatus: 400,
  });

// Not logged here: the error handler already logs every error it answers with.
export const handlePaymentMethod = async (
  cartId: string,
  paymentType: ECTransactionPaymentType = DEFAULT_PAYMENT_TYPE,
  options: ExpressOptions = {},
): Promise<GetPaymentMethodResponse> => {
  assertPaymentTypeEnabled(paymentType);
  const fetched = await getCartById(cartId);
  const cart = options.express ? fetched : await releaseAbandonedExpressAttemptsQuietly(fetched);
  const validated = await validateCart(cart, paymentType, options);
  const paymentTypes =
    paymentType === ECTransactionPaymentType.ECTransactionBillPayment
      ? validated
      : await applyBillPaymentExclusion(cart, validated);

  return {
    webShopId: readConfiguration().easyCredit.webShopId,
    amount: convertCentsToEur(cart.totalPrice.centAmount, cart.totalPrice.fractionDigits),
    paymentTypes,
  };
};

// Handle payment creation logic
// Default strategy, and a cart the shop froze keeps its own. A total changed afterwards fails the authorization with AmountMismatch.
// Returns whether the connector added the placeholder, so the cleanup removes only that one.
const freezeCart = async (
  cart: Cart,
  { express = false }: ExpressOptions = {},
): Promise<{ cart: Cart; addedPlaceholder: boolean }> => {
  if (cart.cartState === CTCartState.Frozen) {
    return { cart, addedPlaceholder: false };
  }

  // commercetools cannot freeze a cart without shipping address; the express return replaces this placeholder.
  const addedPlaceholder = express && !cart.shippingAddress;
  const placeholderAddress: CartUpdateAction[] = addedPlaceholder
    ? [{ action: 'setShippingAddress', address: { country: EXPRESS_PLACEHOLDER_COUNTRY } }]
    : [];

  return { cart: await updateCart(cart, [...placeholderAddress, { action: 'freezeCart' }]), addedPlaceholder };
};

// Without a transaction the payment is an orphan on the cart. Unfreeze first, as removePayment on a frozen cart is undocumented.
const unfreezeAfterFailedCreate = async (
  cart: Cart,
  ownsPlaceholder: boolean,
  orphanPaymentId?: string,
): Promise<void> => {
  const orphanCleanup: CartUpdateAction[] = orphanPaymentId
    ? [{ action: 'removePayment', payment: { typeId: 'payment', id: orphanPaymentId } }]
    : [];

  try {
    await updateCart(cart, [...releaseCartActions(cart, ownsPlaceholder), ...orphanCleanup]);
  } catch (cleanupError: unknown) {
    log.error('Failed to unfreeze the cart after a failed payment creation', cleanupError);
  }
};

const getItemIds = ({ lineItems, customLineItems }: Cart): string =>
  [...lineItems, ...customLineItems].map(({ id }) => id).join(',');

// Regular creates pass the shop's customerRelationship; express derives it from commercetools.
const createPaymentForCart = async (
  cartId: string,
  redirectLinks: ECTransactionRedirectLinksWithoutAuthorizationCallback,
  paymentType: ECTransactionPaymentType,
  options: ExpressOptions,
  customerRelationship?: ECTransactionCustomerRelationship,
): Promise<PaymentResponse> => {
  let cart: Cart | null = null;
  let shouldUnfreezeCart = false;
  let ownsPlaceholder = false;
  // Id of a payment that is attached to the cart but has no transaction written yet
  const orphan: { paymentId?: string } = {};
  try {
    assertPaymentTypeEnabled(paymentType);
    if (options.express) {
      assertRedirectLinks(redirectLinks);
      await assertExpressConfigured();
    }
    cart = await getCartById(cartId);
    if (!options.express) {
      cart = await releaseAbandonedExpressAttempts(cart);
    }
    await validateCart(cart, paymentType, options);
    const { centAmount, currencyCode } = cart.totalPrice;
    const itemIds = getItemIds(cart);

    // After validation, so a rejected request leaves the cart untouched. The re-validation below covers an unfreeze
    // that repriced the cart.
    const discard = await discardStaleAttempts(cart);
    const frozen = await freezeCart(discard.cart, options);
    cart = frozen.cart;
    ownsPlaceholder = frozen.addedPlaceholder || discard.inheritsPlaceholder;
    shouldUnfreezeCart = true;

    // Freezing can reprice the cart or add a 0 € gift line item, so the checks above may no longer hold.
    if (
      cart.totalPrice.centAmount !== centAmount ||
      cart.totalPrice.currencyCode !== currencyCode ||
      getItemIds(cart) !== itemIds
    ) {
      await validateCart(cart, paymentType, options);
    }

    const ctPayment = await createPayment(
      mapCTCartToCTPayment(cart, paymentType, { ...options, placeholderAddress: ownsPlaceholder }),
    );
    cart = await updateCart(cart, [{ action: 'addPayment', payment: { typeId: 'payment', id: ctPayment.id } }]);
    orphan.paymentId = ctPayment.id;

    const ecPayment = await initEasyCreditClient().createPayment(
      await mapCTCartToECPayment(
        cart,
        ctPayment,
        redirectLinks,
        customerRelationship ?? (await getCustomerRelationship(cart)),
        paymentType,
        options,
      ),
    );

    const transactionState =
      ecPayment.transactionInformation.decision.decisionOutcome === ECTransactionDecision.NEGATIVE
        ? CTTransactionState.Failure
        : CTTransactionState.Initial;

    await updatePayment(ctPayment, [
      {
        action: 'addTransaction',
        transaction: {
          state: transactionState,
          type: CTTransactionType.Authorization,
          amount: cart.totalPrice,
          interactionId: ecPayment.transactionId,
          timestamp: new Date().toISOString(),
          custom: {
            type: {
              typeId: 'type',
              key: getTransactionCustomTypeKey(),
            },
            fields: {
              easyCreditTechnicalTransactionId: ecPayment.technicalTransactionId,
            },
          },
        },
      },
    ]);
    orphan.paymentId = undefined;

    if (transactionState === CTTransactionState.Failure) {
      throw new MultiErrorx([
        new Errorx({
          code: 'TransactionNotSuccess',
          message: ecPayment.transactionInformation.decision.decisionOutcomeText,
          httpErrorStatus: 400,
        }),
      ]);
    }

    return mapCreatePaymentResponse(ecPayment, ctPayment);
  } catch (error: unknown) {
    log.error(`Error in ${options.express ? 'handleCreateExpressPayment' : 'handleCreatePayment'}`, error);

    // Validation failures must leave even an already frozen cart untouched.
    if (shouldUnfreezeCart && cart?.cartState === CTCartState.Frozen) {
      await unfreezeAfterFailedCreate(cart, ownsPlaceholder, orphan.paymentId);
    }

    throw error;
  }
};

const paymentTypeUnknownError = () =>
  new Errorx({
    code: 'PaymentTypeUnknown',
    message:
      'easyCredit hat keine gültige Zahlungsart zur Transaktion geliefert. Die Zahlung kann nicht fortgesetzt werden.',
    httpErrorStatus: 502,
  });

const methodInfoActions = (paymentType: ECTransactionPaymentType): PaymentUpdateAction[] => [
  { action: 'setMethodInfoMethod', method: toPaymentMethod(paymentType) },
  { action: 'setMethodInfoName', name: { de: EASYCREDIT_PAYMENT_TYPE_LABELS[paymentType] } },
];

// Writes the method info, retrying once on a 409 version conflict.
const writeMethodInfo = async (payment: Payment, paymentType: ECTransactionPaymentType): Promise<Payment> => {
  try {
    return await updatePayment(payment, methodInfoActions(paymentType));
  } catch (error: unknown) {
    if ((error as Errorx).httpErrorStatus !== 409) {
      throw error;
    }
    return updatePayment(await getPaymentById(payment.id), methodInfoActions(paymentType));
  }
};

// Interest and total value only exist for installments; a field that is set but no longer wanted is removed.
const interestActions = (
  transaction: Transaction,
  ecPayment: ECGetPaymentResponse,
  finalType: ECTransactionPaymentType,
): PaymentUpdateAction[] => {
  const isInstallment = finalType === ECTransactionPaymentType.ECTransactionInstallmentPayment;
  const interest = ecPayment.decision.interest ?? undefined;
  const totalValue = ecPayment.decision.totalValue ?? undefined;
  const stored = transaction.custom?.fields ?? {};
  const fields = [
    { name: EASYCREDIT_INTEREST_FIELD, wanted: isInstallment ? interest : undefined },
    { name: EASYCREDIT_TOTAL_VALUE_FIELD, wanted: isInstallment ? totalValue : undefined },
  ];

  return fields
    .filter(({ name, wanted }) => stored[name] !== wanted)
    .map(({ name, wanted }) => ({
      action: 'setTransactionCustomField',
      transactionId: transaction.id,
      name,
      ...(wanted !== undefined && { value: wanted }),
    }));
};

// Best effort: deployments that did not run post-deploy yet lack the field definitions, and that must not break the summary.
const recordInterest = async (
  payment: Payment,
  ecPayment: ECGetPaymentResponse,
  finalType: ECTransactionPaymentType,
  latest: Payment = payment,
): Promise<void> => {
  try {
    const actions = interestActions(getTransaction(payment) as Transaction, ecPayment, finalType);

    if (actions.length > 0) {
      await updatePayment(latest, actions);
    }
  } catch (error: unknown) {
    log.warn('Failed to record the interest and total value on the transaction', { paymentId: payment.id, error });
  }
};

// Cart errors the shopper cannot outlast: the final type will not become valid for this cart.
const TRANSACTION_FAILING_CODES = [
  'InvalidAmount',
  'BillPaymentExcludedItems',
  'CorporateCustomerNotAllowed',
  'AddressesUnmatched',
  'InvalidBillingAddress',
  'InvalidShippingAddress',
  'InvalidAddress',
  'InvalidCurrency',
];

// Everything else (stale webshop data, 5xx, unknown errors) may heal on a retry and must not fail the transaction.
const failsTransaction = (error: unknown): boolean =>
  error instanceof MultiErrorx && error.errors.every(({ code }) => TRANSACTION_FAILING_CODES.includes(code));

// The validation error is what the caller needs to see, so a failing cleanup is only logged.
const failTransactionQuietly = async (paymentId: string, expectedFrom?: CTTransactionState): Promise<void> => {
  try {
    await failTransaction(paymentId, expectedFrom);
  } catch (error: unknown) {
    log.error('Failed to fail the transaction after a failed payment type validation', error);
  }
};

// The shopper switched to a type nobody validated for the cart; a definitive failure fails the transaction and frees the cart.
// Only an Initial transaction is failed: one that a concurrent authorize moved to Pending has its request in flight.
// An express cart before the return holds the placeholder, so it is checked like at create; the authorize checks the address.
const validateFinalType = async (payment: Payment, paymentType: ECTransactionPaymentType): Promise<void> => {
  const paymentId = payment.id;
  let enabled = false;

  try {
    assertPaymentTypeEnabled(paymentType);
    enabled = true;
    const cart = await getCartByPaymentId(paymentId);
    await validateCart(cart, paymentType, {
      express: isExpressPayment(payment) && isPlaceholderAddress(cart.shippingAddress),
    });
  } catch (error: unknown) {
    // A switched-off type is definitive; once it is enabled only the cart errors in the whitelist are.
    if (!enabled || failsTransaction(error)) {
      await failTransactionQuietly(paymentId, CTTransactionState.Initial);
    }
    throw error;
  }
};

// One log per problem: the unrecognised value has its own message, the absent-type messages are for a missing value.
// A bill payment that is about to be validated and authorized cannot go on without a usable type.
const reportUnusableType = (
  payment: Payment,
  stored: ECTransactionPaymentType,
  raw: string | undefined,
  status: ECTransactionStatus,
  isGated: boolean,
): void => {
  const isBill = stored === ECTransactionPaymentType.ECTransactionBillPayment;

  if (raw) {
    log.error('easyCredit sent an unknown payment type', { paymentId: payment.id, paymentType: raw, status });
  } else if (isBill) {
    log.error('easyCredit sent no payment type for a bill payment', { paymentId: payment.id, status });
  } else {
    log.warn('easyCredit sent no payment type, keeping the stored one', { paymentId: payment.id, stored, status });
  }
  if (isBill && isGated) {
    throw paymentTypeUnknownError();
  }
};

// The shopper can switch between installment and bill on the easyCredit page, so easyCredit holds the final type.
// Returns the final type, or the stored one when nothing is synced.
const syncPaymentType = async (
  payment: Payment,
  ecPayment: ECGetPaymentResponse,
): Promise<ECTransactionPaymentType> => {
  const stored = getPaymentType(payment);
  const status = ecPayment.status;
  const transactionState = getTransaction(payment)?.state;
  // Only here is a final type about to be validated and authorized; elsewhere a missing type must not block anything.
  const isGated = status === ECTransactionStatus.PREAUTHORIZED && transactionState === CTTransactionState.Initial;

  if (
    (status !== ECTransactionStatus.PREAUTHORIZED && status !== ECTransactionStatus.AUTHORIZED) ||
    transactionState === CTTransactionState.Failure
  ) {
    return stored;
  }

  // Trust boundary: an unrecognised value is treated like an absent one.
  const raw = ecPayment.transaction?.paymentType;
  const final = Object.values(ECTransactionPaymentType).includes(raw as ECTransactionPaymentType)
    ? (raw as ECTransactionPaymentType)
    : undefined;

  if (!final) {
    reportUnusableType(payment, stored, raw, status, isGated);
  }

  // Nothing to switch: an absent or unrecognised type keeps the stored one.
  if (!final || final === stored) {
    await recordInterest(payment, ecPayment, stored);
    return stored;
  }

  log.info('Payment type changed on the easyCredit page', { paymentId: payment.id, from: stored, to: final });

  // Only an unauthorized (Initial) transaction can still be failed; otherwise the type is just recorded.
  if (isGated) {
    await validateFinalType(payment, final);
    await recordInterest(payment, ecPayment, final, await writeMethodInfo(payment, final));
    return final;
  }

  let latest = payment;
  try {
    latest = await writeMethodInfo(payment, final);
  } catch (error: unknown) {
    log.warn('Failed to record the payment type, the payment is already authorized', {
      paymentId: payment.id,
      paymentType: final,
      error,
    });
  }
  await recordInterest(payment, ecPayment, final, latest);
  return final;
};

// The payment is already authorized, so a failing sync must neither change the outcome nor throw.
const syncPaymentTypeBestEffort = async (payment: Payment, ecPayment: ECGetPaymentResponse): Promise<void> => {
  try {
    await syncPaymentType(payment, ecPayment);
  } catch (error: unknown) {
    log.warn('Failed to sync the payment type of an authorized payment', { paymentId: payment.id, error });
  }
};

export const handleCreatePayment = async (
  cartId: string,
  redirectLinks: ECTransactionRedirectLinksWithoutAuthorizationCallback,
  customerRelationship: ECTransactionCustomerRelationship,
  paymentType: ECTransactionPaymentType = DEFAULT_PAYMENT_TYPE,
): Promise<PaymentResponse> =>
  createPaymentForCart(cartId, redirectLinks, paymentType, { express: false }, customerRelationship);

// Express handlers take the cartId from the session, never from the request.
// Checked here too, so the shop hides the express buttons instead of failing on click.
export const handleExpressPaymentMethod = async (
  cartId: string | undefined,
  paymentType: ECTransactionPaymentType = DEFAULT_PAYMENT_TYPE,
): Promise<GetPaymentMethodResponse> => {
  const sessionCartId = assertSessionCart(cartId);
  await assertExpressConfigured();

  return handlePaymentMethod(sessionCartId, paymentType, { express: true });
};

export const handleCreateExpressPayment = async (
  cartId: string | undefined,
  redirectLinks: ECTransactionRedirectLinksWithoutAuthorizationCallback,
  paymentType: ECTransactionPaymentType = DEFAULT_PAYMENT_TYPE,
): Promise<PaymentResponse> =>
  createPaymentForCart(assertSessionCart(cartId), redirectLinks, paymentType, { express: true });

export const handleGetPayment = async (paymentId: string): Promise<GetPaymentResponse> => {
  try {
    const payment = await getPaymentById(paymentId);

    validatePayment(payment);
    validateTransaction(payment);

    const transaction = getTransaction(payment) as Transaction;
    const ecTechnicalTransactionId = transaction.custom?.fields.easyCreditTechnicalTransactionId as string;

    const ecPayment = await initEasyCreditClient().getPayment(ecTechnicalTransactionId);
    const paymentType = await syncPaymentType(payment, ecPayment);

    // The response schema serializes a JSON null number as 0 (interest 0 for a bill payment), so drop the nulls.
    const decision = ecPayment.decision
      ? (Object.fromEntries(
          Object.entries(ecPayment.decision).filter(([, value]) => value !== null),
        ) as GetPaymentResponse['decision'])
      : ecPayment.decision;

    return {
      ...ecPayment,
      decision,
      paymentType,
      amount: convertCentsToEur(transaction.amount.centAmount, transaction.amount.fractionDigits),
      webShopId: readConfiguration().easyCredit.webShopId,
    };
  } catch (error: unknown) {
    log.error('Error in getting summary Payment', error);
    throw error;
  }
};

const AUTHORIZATION_DECLINED_STATUSES = [ECTransactionStatus.DECLINED, ECTransactionStatus.EXPIRED];

const notPreauthorizedError = () =>
  new Errorx({
    code: 'TransactionNotPreauthorized',
    message: 'You are not allow to authorize Easy Credit transaction without preauthorizing it first.',
    httpErrorStatus: 400,
  });

const paymentInProgressError = () =>
  new Errorx({
    code: 'PaymentInProgress',
    message:
      'Es ist bereits eine easyCredit Zahlung offen. Bitte brechen Sie diese ab oder warten Sie einen Moment und versuchen Sie es erneut.',
    httpErrorStatus: 400,
  });

const notAuthorizedError = () =>
  new Errorx({
    code: 'TransactionNotAuthorized',
    message: 'You are not allow to authorize a payment without EasyCredit Authorized transaction.',
    httpErrorStatus: 400,
  });

// commercetools does not enforce transitions on changeTransactionState, so the connector does.
const ALLOWED_TRANSITIONS: Partial<Record<CTTransactionState, CTTransactionState[]>> = {
  [CTTransactionState.Initial]: [CTTransactionState.Pending, CTTransactionState.Success, CTTransactionState.Failure],
  [CTTransactionState.Pending]: [CTTransactionState.Success, CTTransactionState.Failure],
};

type TransitionOutcome = 'changed' | 'alreadyInState' | 'refused';

// Sets the authorization transaction state, retrying once on a 409 version conflict.
// 'alreadyInState' when the freshly read transaction is in the requested state, 'refused' when the transition is not
// allowed or, with expectedFrom, when that transaction is in another state.
const transitionTransaction = async (
  paymentId: string,
  state: CTTransactionState,
  expectedFrom?: CTTransactionState,
): Promise<TransitionOutcome> => {
  for (let attempt = 0; ; attempt++) {
    const payment = await getPaymentById(paymentId);
    const transaction = getTransaction(payment) as Transaction;
    if (transaction.state === state) {
      return 'alreadyInState';
    }
    if (
      (expectedFrom && transaction.state !== expectedFrom) ||
      !ALLOWED_TRANSITIONS[transaction.state as CTTransactionState]?.includes(state)
    ) {
      log.warn('Refused an invalid transaction state transition', {
        paymentId,
        currentState: transaction.state,
        requestedState: state,
        expectedFrom,
      });
      return 'refused';
    }
    try {
      await updatePayment(payment, [{ action: 'changeTransactionState', transactionId: transaction.id, state }]);
      return 'changed';
    } catch (error: unknown) {
      if (attempt > 0 || (error as Errorx).httpErrorStatus !== 409) {
        throw error;
      }
    }
  }
};

// True when the transaction is in the requested state afterwards.
const setTransactionState = async (
  paymentId: string,
  state: CTTransactionState,
  expectedFrom?: CTTransactionState,
): Promise<boolean> => (await transitionTransaction(paymentId, state, expectedFrom)) !== 'refused';

// A Success transaction is never failed and its cart stays frozen for the order.
// With expectedFrom, a transaction that is in another state is left alone. An already failed one still gets its cart released.
const failTransaction = async (paymentId: string, expectedFrom?: CTTransactionState): Promise<void> => {
  const outcome = await transitionTransaction(paymentId, CTTransactionState.Failure, expectedFrom);
  if (outcome === 'refused') {
    return;
  }
  try {
    await releaseCartOfEndedAttempt(await getPaymentById(paymentId));
  } catch (error: unknown) {
    log.error('Error in unfreezing cart after failed authorization', error);
  }
};

// Live observation: easyCredit invalidates an older transaction once a newer one exists (its payment page then shows
// error 410). The status of the transaction lookup for such a transaction is not verified yet, so 404 and 410 both count.
const isGoneAtEasyCredit = (error: unknown): boolean => {
  const status = (error as Partial<Errorx> | undefined)?.httpErrorStatus;
  return status === 404 || status === 410;
};

// Throws when the attempt may still become an order, returns true when it can be discarded.
const isStaleAttempt = async (payment: Payment): Promise<boolean> => {
  const transaction = getTransaction(payment);

  if (!transaction || transaction.state === CTTransactionState.Failure) {
    return false;
  }
  if (transaction.state !== CTTransactionState.Initial) {
    throw paymentInProgressError();
  }

  const technicalTransactionId = transaction.custom?.fields.easyCreditTechnicalTransactionId as string;
  let ecPayment: ECGetPaymentResponse;
  try {
    ecPayment = await initEasyCreditClient().getPayment(
      technicalTransactionId,
      AbortSignal.timeout(EASYCREDIT_CALLBACK_LOOKUP_TIMEOUT_MS),
    );
  } catch (error: unknown) {
    if (isGoneAtEasyCredit(error)) {
      return true;
    }
    log.warn('Could not check the earlier easyCredit attempt, refusing a new one', { paymentId: payment.id, error });
    throw paymentInProgressError();
  }

  if (ecPayment.status === ECTransactionStatus.AUTHORIZED) {
    throw paymentInProgressError();
  }
  return true;
};

// The shopper switched the payment type in the shop checkout while the cart still holds an earlier attempt.
// Pass 1 only reads, so a refusal mutates nothing; pass 2 fails the stale transactions and replaces them in one cart update.
// handleCancelPayment (cancel webhook) stays as is: it also cancels Pending, while create refuses Pending.
// A placeholder added for a discarded express attempt stays, as the cart is refrozen, and passes to the new attempt.
const discardStaleAttempts = async (cart: Cart): Promise<{ cart: Cart; inheritsPlaceholder: boolean }> => {
  const discarded: string[] = [];
  let placeholderOwned = false;

  for (const { id } of cart.paymentInfo?.payments ?? []) {
    const payment = await getPaymentById(id);

    if (isEasyCreditPayment(payment)) {
      if (await isStaleAttempt(payment)) {
        discarded.push(id);
        placeholderOwned ||= ownsPlaceholderAddress(payment);
      }
    }
  }

  if (discarded.length === 0) {
    return { cart, inheritsPlaceholder: false };
  }

  for (const id of discarded) {
    // The attempt is no longer Initial (e.g. its authorization was written Pending), so it is no longer ours to remove.
    // Residual window: the authorize flow writes Pending only after its POST, so an attempt can still be Initial while
    // the request is out. It is then discarded here and handleAuthorizeECPayment logs EASYCREDIT_AUTHORIZATION_SENT_ATTEMPT_DISCARDED.
    if (!(await setTransactionState(id, CTTransactionState.Failure, CTTransactionState.Initial))) {
      throw paymentInProgressError();
    }
  }

  const isFrozen = cart.cartState === CTCartState.Frozen;

  const updated = await updateCart(cart, [
    ...(isFrozen ? [{ action: 'unfreezeCart' as const }] : []),
    ...discarded.map((id) => ({ action: 'removePayment' as const, payment: { typeId: 'payment' as const, id } })),
    ...(isFrozen ? [{ action: 'freezeCart' as const, strategy: cart.freezeStrategy }] : []),
  ]);

  return { cart: updated, inheritsPlaceholder: placeholderOwned && isPlaceholderAddress(updated.shippingAddress) };
};

const DIVERGENCE_LOG = 'EASYCREDIT_AUTHORIZED_CT_NOT_SUCCESS';

// easyCredit authorized the payment but commercetools will not say Success: needs manual follow-up.
const logDivergence = (paymentId: string, technicalTransactionId: string, reason: string) =>
  log.error(`${DIVERGENCE_LOG}: easyCredit is AUTHORIZED but the commercetools transaction is not Success`, {
    paymentId,
    technicalTransactionId,
    reason,
  });

// Best effort: a failing lookup must not turn a completed cancel into an error.
const logLateAuthorization = async (paymentId: string, technicalTransactionId: string): Promise<void> => {
  const ecPayment = await initEasyCreditClient()
    .getPayment(technicalTransactionId, AbortSignal.timeout(EASYCREDIT_CALLBACK_LOOKUP_TIMEOUT_MS))
    .catch((error: unknown) => {
      log.warn('Could not re-check the easyCredit status after cancelling a Pending transaction', error);
      return undefined;
    });

  if (ecPayment?.status === ECTransactionStatus.AUTHORIZED) {
    logDivergence(paymentId, technicalTransactionId, 'cancelled while the authorization was in flight');
  }
};

const getEcCents = (ecPayment: ECGetPaymentResponse): number | undefined => {
  const ecValue = ecPayment.transaction?.orderDetails?.orderValue ?? ecPayment.decision?.orderValue;
  return typeof ecValue === 'number' ? eurToCents(ecValue) : undefined;
};

const failWithAmountMismatch = async (
  paymentId: string,
  detail: string,
  expectedFrom?: CTTransactionState,
): Promise<never> => {
  await failTransaction(paymentId, expectedFrom);
  throw new Errorx({
    code: 'AmountMismatch',
    message: 'Der Warenkorb wurde nach der Zahlungsfreigabe geaendert. Die Zahlung wurde abgebrochen.',
    httpErrorStatus: 400,
    privateMessage: `AmountMismatch: ${detail}`,
  });
};

// Before the authorization request: the cart must still be frozen and cart, transaction and easyCredit amounts must
// agree. Returns the cart it read. With expectedFrom, only a transaction that is still in that state is failed.
const assertAmountMatches = async (
  paymentId: string,
  ecPayment: ECGetPaymentResponse,
  expectedFrom?: CTTransactionState,
): Promise<Cart> => {
  const cart = await getCartByPaymentId(paymentId);
  const transaction = getTransaction(await getPaymentById(paymentId)) as Transaction;
  const ecCents = getEcCents(ecPayment);

  if (
    cart.cartState !== CTCartState.Frozen ||
    ecCents === undefined ||
    cart.totalPrice.centAmount !== transaction.amount.centAmount ||
    cart.totalPrice.centAmount !== ecCents
  ) {
    await failWithAmountMismatch(
      paymentId,
      `cart ${cart.cartState} ${cart.totalPrice.centAmount}, transaction ${transaction.amount.centAmount}, easyCredit ${ecCents}`,
      expectedFrom,
    );
  }

  return cart;
};

// Once easyCredit authorized, the default mode has already answered 204: the shop may have ordered or deleted the cart.
// A deleted cart leaves transaction against easyCredit, which the pre-request check tied to the frozen cart.
const assertAuthorizedAmountMatches = async (paymentId: string, ecPayment: ECGetPaymentResponse): Promise<void> => {
  const cart = await getCartByPaymentId(paymentId).catch((error: unknown) => {
    if ((error as Partial<Errorx>)?.code === 'CartNotFound') {
      return undefined;
    }
    throw error;
  });
  const transaction = getTransaction(await getPaymentById(paymentId)) as Transaction;
  const ecCents = getEcCents(ecPayment);
  const cartMatches =
    !cart ||
    ((cart.cartState === CTCartState.Frozen || cart.cartState === CTCartState.Ordered) &&
      cart.totalPrice.centAmount === transaction.amount.centAmount);

  if (!cartMatches || ecCents === undefined || transaction.amount.centAmount !== ecCents) {
    const cartDetail = cart ? `${cart.cartState} ${cart.totalPrice.centAmount}` : 'missing';
    await failWithAmountMismatch(
      paymentId,
      `cart ${cartDetail}, transaction ${transaction.amount.centAmount}, easyCredit ${ecCents}`,
    );
  }
};

// A frozen cart still accepts address and company updates, so the bill rules can break after init. Express skipped the
// address checks at init, so they run here for every type. Only runs for an Initial transaction, so a concurrent
// authorize that wrote Pending keeps its attempt.
const assertCartRulesHold = async (
  paymentId: string,
  cart: Cart,
  paymentType: ECTransactionPaymentType,
): Promise<void> => {
  try {
    validateCartData(cart, paymentType, { webShopId: readConfiguration().easyCredit.webShopId });
  } catch (error: unknown) {
    if (failsTransaction(error)) {
      await failTransactionQuietly(paymentId, CTTransactionState.Initial);
    }
    throw error;
  }
};

// easyCredit is AUTHORIZED here: any failure of the check or the Success write is logged once, then rethrown.
const finalizeSuccess = async (
  paymentId: string,
  technicalTransactionId: string,
  ecPayment: ECGetPaymentResponse,
): Promise<void> => {
  try {
    // An overlapping flow may have finished already; the cart can be Ordered by now.
    const current = getTransaction(await getPaymentById(paymentId)) as Transaction;
    if (current.state === CTTransactionState.Success) {
      return;
    }
    await assertAuthorizedAmountMatches(paymentId, ecPayment);
    if (!(await setTransactionState(paymentId, CTTransactionState.Success))) {
      throw notAuthorizedError();
    }
  } catch (error: unknown) {
    const reason = error instanceof Errorx && error.privateMessage ? error.privateMessage : (error as Error)?.message;
    logDivergence(paymentId, technicalTransactionId, reason ?? String(error));
    throw error;
  }
};

// Network errors, aborts and HTTP 5xx/408/429 are worth another poll; other 4xx will not heal by waiting.
const isTransientPollError = (error: unknown): boolean => {
  const { httpErrorStatus } = error as Partial<Errorx>;
  if (typeof httpErrorStatus !== 'number') {
    return true;
  }
  return httpErrorStatus >= 500 || httpErrorStatus === 408 || httpErrorStatus === 429;
};

const authorizationTimeoutError = () =>
  new Errorx({
    code: 'AuthorizationTimeout',
    message: 'Die Autorisierung bei easyCredit ist noch nicht abgeschlossen. Bitte spaeter erneut versuchen.',
    httpErrorStatus: 504,
  });

const pollUntilAuthorized = async (paymentId: string, technicalTransactionId: string, deadline: number) => {
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw authorizationTimeoutError();
    }
    const ecPayment = await initEasyCreditClient()
      .getPayment(technicalTransactionId, AbortSignal.timeout(remaining))
      .catch((error: unknown) => {
        if (!isTransientPollError(error)) {
          throw error;
        }
        log.warn('Polling EasyCredit authorization failed, retrying', error);
        return undefined;
      });
    if (ecPayment?.status === ECTransactionStatus.AUTHORIZED) {
      return await finalizeSuccess(paymentId, technicalTransactionId, ecPayment);
    }
    if (ecPayment && AUTHORIZATION_DECLINED_STATUSES.includes(ecPayment.status)) {
      await failTransaction(paymentId);
      throw notPreauthorizedError();
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(EASYCREDIT_AUTHORIZATION_POLL_INTERVAL_MS, deadline - Date.now())),
    );
  }
};

// First authorize call of an Initial transaction: check the cart, send the authorization request, record Pending.
const requestAuthorization = async (
  paymentId: string,
  technicalTransactionId: string,
  ecPayment: ECGetPaymentResponse,
  paymentType: ECTransactionPaymentType,
  deadline: number,
  express: boolean,
): Promise<void> => {
  const cart = await assertAmountMatches(paymentId, ecPayment, CTTransactionState.Initial);
  // Not a transaction failure: the express return may still set the address.
  if (express && isPlaceholderAddress(cart.shippingAddress)) {
    throw expressAddressMissingError();
  }
  if (express || paymentType === ECTransactionPaymentType.ECTransactionBillPayment) {
    await assertCartRulesHold(paymentId, cart, paymentType);
  }
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw authorizationTimeoutError();
  }
  await initEasyCreditClient().authorizePayment(technicalTransactionId, paymentId, AbortSignal.timeout(remaining));
  // The request is out, but the transaction was Initial until now: a concurrent create or switch may have discarded
  // it. A fast callback may have written Success already, which a waiting caller's poll then sees at once.
  if (!(await setTransactionState(paymentId, CTTransactionState.Pending, CTTransactionState.Initial))) {
    const currentState = getTransaction(await getPaymentById(paymentId))?.state;
    if (currentState !== CTTransactionState.Success) {
      log.error(
        `EASYCREDIT_AUTHORIZATION_SENT_ATTEMPT_DISCARDED: the authorization request was sent but the commercetools transaction is no longer Initial, the attempt was discarded concurrently and easyCredit may still authorize it`,
        { paymentId, technicalTransactionId, currentState },
      );
      throw notAuthorizedError();
    }
  }
};

// Without waitForAuthorization it answers once the request is sent, and the easyCredit callback sets Success.
export const handleAuthorizeECPayment = async (paymentId: string, waitForAuthorization = false): Promise<void> => {
  try {
    const deadline = Date.now() + EASYCREDIT_AUTHORIZATION_TIMEOUT_MS;
    const payment = await getPaymentById(paymentId);

    validatePayment(payment);
    validateTransaction(payment);

    const transaction = getTransaction(payment) as Transaction;
    const technicalTransactionId = transaction.custom?.fields.easyCreditTechnicalTransactionId as string;

    if (transaction.state === CTTransactionState.Success) {
      return;
    }
    if (transaction.state !== CTTransactionState.Initial && transaction.state !== CTTransactionState.Pending) {
      throw notPreauthorizedError();
    }

    // The client does not map aborts (the poll loop relies on that), so map them here.
    const ecPayment = await initEasyCreditClient()
      .getPayment(technicalTransactionId, AbortSignal.timeout(Math.max(deadline - Date.now(), 1)))
      .catch((error: unknown) => {
        const { name } = (error ?? {}) as { name?: string };
        throw name === 'TimeoutError' || name === 'AbortError' ? authorizationTimeoutError() : error;
      });

    if (ecPayment.status === ECTransactionStatus.AUTHORIZED) {
      await syncPaymentTypeBestEffort(payment, ecPayment);
      return await finalizeSuccess(paymentId, technicalTransactionId, ecPayment);
    }
    if (AUTHORIZATION_DECLINED_STATUSES.includes(ecPayment.status)) {
      await failTransaction(paymentId);
      throw notPreauthorizedError();
    }
    if (ecPayment.status !== ECTransactionStatus.PREAUTHORIZED) {
      throw notPreauthorizedError();
    }

    const paymentType = await syncPaymentType(payment, ecPayment);

    if (transaction.state === CTTransactionState.Initial) {
      await requestAuthorization(
        paymentId,
        technicalTransactionId,
        ecPayment,
        paymentType,
        deadline,
        isExpressPayment(payment),
      );
    }

    if (waitForAuthorization) {
      await pollUntilAuthorized(paymentId, technicalTransactionId, deadline);
    }
  } catch (error: unknown) {
    log.error('Error in authorizing EasyCredit Payment', error);
    throw error;
  }
};

export const handleAuthorizePayment = async (paymentId: string): Promise<void> => {
  try {
    const payment = await getPaymentById(paymentId);

    validatePayment(payment);
    validateTransaction(payment);

    const transaction = getTransaction(payment) as Transaction;
    if (transaction.state === CTTransactionState.Success) {
      return;
    }
    const ecTechnicalTransactionId = transaction.custom?.fields.easyCreditTechnicalTransactionId as string;
    if (transaction.state !== CTTransactionState.Initial && transaction.state !== CTTransactionState.Pending) {
      // Best effort: only to spot a payment easyCredit authorized although commercetools failed it.
      const ecStatus = await initEasyCreditClient()
        .getPayment(ecTechnicalTransactionId, AbortSignal.timeout(EASYCREDIT_CALLBACK_LOOKUP_TIMEOUT_MS))
        .then((ecPayment) => ecPayment.status)
        .catch(() => undefined);
      if (ecStatus === ECTransactionStatus.AUTHORIZED) {
        logDivergence(paymentId, ecTechnicalTransactionId, `callback on a ${transaction.state} transaction`);
      }
      throw notAuthorizedError();
    }

    const ecPayment = await initEasyCreditClient().getPayment(ecTechnicalTransactionId);

    if (ecPayment.status === ECTransactionStatus.AUTHORIZED) {
      await finalizeSuccess(paymentId, ecTechnicalTransactionId, ecPayment);
      // Re-read: finalizeSuccess bumped the version. A failing record must not turn the finished callback into an error.
      await syncPaymentTypeBestEffort(await getPaymentById(paymentId).catch(() => payment), ecPayment);
      return;
    }
    if (AUTHORIZATION_DECLINED_STATUSES.includes(ecPayment.status)) {
      await failTransaction(paymentId);
    }
    throw notAuthorizedError();
  } catch (error: unknown) {
    log.error('Error in authorizing CT Payment', error);
    throw error;
  }
};

export const handleCancelPayment = async (paymentId: string): Promise<string> => {
  try {
    const payment = await getPaymentById(paymentId);

    validatePayment(payment);

    // Already failed, e.g. discarded by a newer attempt in another tab, or a retry after the release below failed.
    if (getTransaction(payment)?.state === CTTransactionState.Failure) {
      log.info('Cancel of an already failed easyCredit attempt', { paymentId });
      await releaseCartOfEndedAttempt(payment).catch((error: unknown) =>
        log.error('Failed to release the cart of an already failed easyCredit attempt', { paymentId, error }),
      );
      return paymentId;
    }

    const transaction = validateInitialOrPendingTransaction(payment);
    const ecTechnicalTransactionId = transaction.custom?.fields.easyCreditTechnicalTransactionId as string;

    // A transaction that easyCredit invalidated cannot be authorized any more: cancel it and free the cart anyway.
    const easyCreditTransaction = await initEasyCreditClient()
      .getPayment(ecTechnicalTransactionId)
      .catch((error: unknown) => {
        if (!isGoneAtEasyCredit(error)) {
          throw error;
        }
        log.warn('The easyCredit transaction is gone, cancelling without the status check', { paymentId });
        return undefined;
      });

    if (easyCreditTransaction?.status === ECTransactionStatus.AUTHORIZED) {
      throw new Errorx({
        code: 'TransactionIsAuthorized',
        message: 'You are not allow to cancel a payment with Easy Credit AUTHORIZED transaction.',
        httpErrorStatus: 400,
      });
    }

    await updatePayment(payment, [
      { action: 'changeTransactionState', transactionId: transaction.id, state: CTTransactionState.Failure },
    ]);

    // A Pending transaction means the authorization request was already sent, so easyCredit may have
    // authorized it between the check above and the Failure write. The write cannot be made atomic: log it.
    if (transaction.state === CTTransactionState.Pending) {
      await logLateAuthorization(paymentId, ecTechnicalTransactionId);
    }

    await releaseCart(await getCartByPaymentId(payment.id), ownsPlaceholderAddress(payment));

    return paymentId;
  } catch (error) {
    log.error('Error in cancelling payment and unfreezing cart', error);
    throw error;
  }
};

// Nothing was sent to easyCredit yet, so a network error or timeout of the status read is a plain gateway error, not a 500.
const toCaptureLookupError = (error: unknown): unknown => {
  if (error instanceof Errorx) {
    return error;
  }
  // DOMException is not always an Error instance across realms, so match on the name only.
  const name = (error as { name?: string } | null)?.name;
  const timedOut = name === 'AbortError' || name === 'TimeoutError';
  return new Errorx({
    code: 'CaptureFailed',
    message: 'Capture failed',
    httpErrorStatus: timedOut ? 504 : 502,
    cause: error,
  });
};

const MAX_STATE_UPDATE_ATTEMPTS = 3;

// The action targets one transaction, so after a parallel update it is repeated on the latest version,
// unless the transaction has left its state meanwhile, for example completed by a notification.
const changeTransactionState = async (
  payment: Payment,
  transaction: Transaction,
  state: CTTransactionState,
): Promise<Payment> => {
  let current = payment;
  for (let attempt = 1; ; attempt++) {
    try {
      return await updatePayment(current, [{ action: 'changeTransactionState', transactionId: transaction.id, state }]);
    } catch (error) {
      if ((error as Errorx).httpErrorStatus !== 409 || attempt >= MAX_STATE_UPDATE_ATTEMPTS) {
        throw error;
      }
      current = await getPaymentById(payment.id);
      if (current.transactions.find(({ id }) => id === transaction.id)?.state !== transaction.state) {
        return current;
      }
    }
  }
};

// The easyCredit error is what the caller needs, so a failed state update must not replace it.
const markTransactionAsFailed = async (payment: Payment, transaction: Transaction): Promise<void> => {
  await changeTransactionState(payment, transaction, CTTransactionState.Failure).catch((updateError) =>
    log.error('Failed to mark transaction as failed', {
      paymentId: payment.id,
      transactionId: transaction.id,
      type: transaction.type,
      error: updateError,
    }),
  );
};

// Returns undefined if a parallel capture request added its Charge first.
const addPendingCharge = async (
  payment: Payment,
  authorization: Transaction,
  earlierCaptureBookings: string[],
): Promise<Payment | undefined> => {
  try {
    return await updatePayment(payment, [
      { action: 'addTransaction', transaction: mapPendingChargeTransaction(authorization, earlierCaptureBookings) },
    ]);
  } catch (error) {
    if ((error as Errorx).httpErrorStatus === 409 && getActiveCaptureTransaction(await getPaymentById(payment.id))) {
      log.info('Payment was captured by a parallel request', { paymentId: payment.id });
      return undefined;
    }
    throw error;
  }
};

// Completes a Pending Charge from the easyCredit bookings, as its notification may never come.
// Returns the payment to capture again on, or undefined while the capture is open or done.
const settlePendingCharge = async (
  payment: Payment,
  charge: Transaction,
  ecTransaction: ECGetMerchantTransactionResponse,
): Promise<Payment | undefined> => {
  const logContext = { paymentId: payment.id, transactionId: charge.id, ecStatus: ecTransaction.status };
  if (!ecTransaction.bookings) {
    log.warn('easyCredit sent the transaction without bookings, the Pending Charge stays open', logContext);
    return undefined;
  }
  const captureBookings = getCaptureBooking(ecTransaction.bookings);
  const result = getCaptureResult(captureBookings, charge);

  if (result?.status === EASYCREDIT_BOOKING_STATUS_DONE) {
    await changeTransactionState(payment, charge, CTTransactionState.Success);
    log.info('Pending Charge completed from the easyCredit capture booking', logContext);
    return undefined;
  }

  // Without a booking of its own, the Charge is failed only if easyCredit still waits for a capture
  // and the request that added the Charge is past its capture call.
  const neverReceived =
    getChargeCaptureBookings(captureBookings, charge).length === 0 &&
    EASYCREDIT_CAPTURE_NOT_REPORTED_STATUSES.includes(ecTransaction.status) &&
    !isCaptureInFlight(charge);
  if (!result && !neverReceived) {
    log.info('Payment capture is still being processed, capture request ignored', logContext);
    return undefined;
  }

  log.warn('Pending Charge set to Failure before capturing again', {
    ...logContext,
    reason: result?.message?.messageEN ?? 'easyCredit has not received the capture',
  });
  const failed = await changeTransactionState(payment, charge, CTTransactionState.Failure);
  return getActiveCaptureTransaction(failed) ? undefined : failed;
};

// The notification is the usual way to complete refunds; this covers the ones it never completed.
// Without the bookings or after a failed write the refunds stay open, which does not block the request.
const settleRefunds = async (
  payment: Payment,
  ecTransaction: ECGetMerchantTransactionResponse | undefined,
): Promise<Payment> => {
  if (!ecTransaction || getOpenRefundTransactions(payment).length === 0) {
    return payment;
  }
  if (!ecTransaction.bookings) {
    log.warn('easyCredit sent the transaction without bookings, open refunds stay open', { paymentId: payment.id });
    return payment;
  }
  try {
    return await settleOpenRefunds(payment, ecTransaction.bookings);
  } catch (error) {
    log.warn('Open refunds could not be settled from the easyCredit bookings', { paymentId: payment.id, error });
    return await getPaymentById(payment.id);
  }
};

// Only open refunds need the bookings before a refund, so the read is skipped without them and a failed one is not fatal.
const readTransactionForOpenRefunds = async (
  payment: Payment,
  ecTransactionId: string,
): Promise<ECGetMerchantTransactionResponse | undefined> => {
  if (getOpenRefundTransactions(payment).length === 0) {
    return undefined;
  }
  return await initEasyCreditClient()
    .getMerchantTransaction(ecTransactionId)
    .catch((error: unknown) => {
      log.warn('easyCredit bookings could not be read, open refunds stay open', { paymentId: payment.id, error });
      return undefined;
    });
};

// The capture bookings a new Charge must not take as its own. Without the list, an earlier capture
// cannot be told apart from the new one, unless the payment never had a Charge.
const getEarlierCaptureBookings = (payment: Payment, ecTransaction: ECGetMerchantTransactionResponse): string[] => {
  if (ecTransaction.bookings) {
    return getCaptureBooking(ecTransaction.bookings).map(({ uuid }) => uuid);
  }
  if (payment.transactions.some(({ type }) => type === CTTransactionType.Charge)) {
    throw new Errorx({
      code: 'CaptureFailed',
      message: 'easyCredit sent the transaction without bookings, capture not sent',
      httpErrorStatus: 502,
    });
  }
  return [];
};

export const handleCapturePayment = async (paymentId: string, trackingNumber?: string): Promise<void> => {
  const fetchedPayment = await getPaymentById(paymentId);

  validatePayment(fetchedPayment);
  validateSuccessTransaction(fetchedPayment);

  // A repeated request, for example a shipping event sent twice, succeeds without capturing again.
  if (getSuccessCaptureTransactions(fetchedPayment).length > 0) {
    log.info('Payment already captured, capture request ignored', { paymentId });
    return;
  }

  const transaction = getSuccessTransaction(fetchedPayment) as Transaction;
  // Read once for the open refunds, the Pending Charge and the bookings of earlier captures.
  const ecTransaction = await initEasyCreditClient()
    .getMerchantTransaction(transaction.interactionId as string)
    .catch((error: unknown) => {
      throw toCaptureLookupError(error);
    });

  const payment = await settleRefunds(fetchedPayment, ecTransaction);

  let current = payment;
  const pendingCharge = getPendingCaptureTransactions(payment)[0];
  if (pendingCharge) {
    const settled = await settlePendingCharge(payment, pendingCharge, ecTransaction);
    if (!settled) {
      return;
    }
    current = settled;
  }

  const earlierCaptureBookings = getEarlierCaptureBookings(current, ecTransaction);
  const ecTechnicalTransactionId = transaction.custom?.fields.easyCreditTechnicalTransactionId as string;

  const easyCreditTransaction = await initEasyCreditClient()
    .getPayment(ecTechnicalTransactionId, AbortSignal.timeout(EASYCREDIT_REQUEST_TIMEOUT_MS))
    .catch((error: unknown) => {
      throw toCaptureLookupError(error);
    });

  if (easyCreditTransaction.status !== ECTransactionStatus.AUTHORIZED) {
    throw new Errorx({
      code: 'TransactionIsNotAuthorized',
      message: 'You are not allow to capture a payment without Easy Credit AUTHORIZED transaction.',
      httpErrorStatus: 400,
    });
  }

  // Added before easyCredit is called, so an early notification finds the Charge and a parallel capture hits the version lock.
  const chargedPayment = await addPendingCharge(current, transaction, earlierCaptureBookings);
  if (!chargedPayment) {
    return;
  }
  const charge = getAddedTransaction(
    current,
    chargedPayment,
    CTTransactionType.Charge,
    CTTransactionState.Pending,
  ) as Transaction;

  try {
    await initEasyCreditClient().capturePayment(
      easyCreditTransaction.decision.transactionId,
      paymentId,
      trackingNumber,
    );
  } catch (error) {
    // easyCredit captures a transaction only once, so a retry after Failure is safe even if it received this request.
    await markTransactionAsFailed(chargedPayment, charge);
    throw error;
  }

  log.info('Capture payment initiated successfully', { paymentId });
};

// The response is 202 with the payment either way; the refund transaction state carries the outcome.
export const handleRefundPayment = async (paymentId: string, refundAmount: number): Promise<Payment> => {
  const refundCents = validateRefundAmountFormat(refundAmount);
  const fetchedPayment = await getPaymentById(paymentId);

  validatePayment(fetchedPayment);
  validateSuccessTransaction(fetchedPayment);

  const ecTransactionId = getSuccessTransaction(fetchedPayment)?.interactionId as string;

  // Settled first, so a refund that failed meanwhile no longer counts against the remaining amount.
  const payment = await settleRefunds(
    fetchedPayment,
    await readTransactionForOpenRefunds(fetchedPayment, ecTransactionId),
  );
  validateRefundAmountLeft(payment, refundCents);

  const updatedCTPayment = await updatePayment(payment, [
    {
      action: 'addTransaction',
      transaction: {
        type: CTTransactionType.Refund,
        state: CTTransactionState.Initial,
        amount: mapAmountToCTTransactionAmount(refundCents / 100),
        timestamp: new Date().toISOString(),
      },
    },
  ]);

  const initialRefundTransaction = validateInitialRefundTransaction(payment, updatedCTPayment);

  const refundPayload: ECRefundPayload = {
    value: refundCents / 100,
    bookingId: initialRefundTransaction.id,
  };

  let state = CTTransactionState.Pending;
  try {
    await initEasyCreditClient().refundPayment(ecTransactionId, refundPayload);
  } catch (error) {
    // easyCredit may still book a refund with an unknown outcome, so it stays open for the notification.
    if (!(error instanceof ECOutcomeUnknownError)) {
      state = CTTransactionState.Failure;
    }
    log.error('easyCredit did not accept the refund', {
      paymentId,
      transactionId: initialRefundTransaction.id,
      state,
      error,
    });
  }

  try {
    return await changeTransactionState(updatedCTPayment, initialRefundTransaction, state);
  } catch (updateError) {
    // Nothing was booked for a failed refund, so the caller may retry; an open one must not invite a second refund.
    if (state === CTTransactionState.Failure) {
      throw updateError;
    }
    log.error('The refund is open at easyCredit, but its Pending state was not saved', {
      paymentId,
      transactionId: initialRefundTransaction.id,
      error: updateError,
    });
    return updatedCTPayment;
  }
};
