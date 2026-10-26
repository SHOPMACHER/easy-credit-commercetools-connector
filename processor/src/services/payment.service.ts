import { Cart, Errorx, MultiErrorx, Payment, Transaction } from '@commercetools/connect-payments-sdk';
import { getCartById, getCartByPaymentId, updateCart } from '../commercetools/cart.commercetools';
import { readConfiguration } from '../utils/config.utils';

import {
  CTCartState,
  CTTransactionState,
  CTTransactionType,
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
  validatePaymentAmount,
  validatePaymentTypeAvailability,
  validatePrivateCustomer,
  validateShippingDestinations,
  validateSuccessTransaction,
  validateTransaction,
} from '../validators/payment.validators';
import { createPayment, getPaymentById, updatePayment } from '../commercetools/payment.commercetools';
import { getPaymentType, getSuccessTransaction, getTransaction } from '../utils/payment.utils';
import { initEasyCreditClient } from '../client/easycredit.client';
import {
  getShippingAddress,
  getShippingDestinations,
  mapAmountToCTTransactionAmount,
  mapCreatePaymentResponse,
  mapCTCartToCTPayment,
  mapCTCartToECPayment,
} from '../utils/map.utils';
import { convertCentsToEur, eurToCents } from '../utils/app.utils';
import {
  EASYCREDIT_AUTHORIZATION_POLL_INTERVAL_MS,
  EASYCREDIT_AUTHORIZATION_TIMEOUT_MS,
  EASYCREDIT_CALLBACK_LOOKUP_TIMEOUT_MS,
  EASYCREDIT_INTEREST_FIELD,
  EASYCREDIT_PAYMENT_METHOD,
  EASYCREDIT_PAYMENT_TYPE_LABELS,
  EASYCREDIT_TOTAL_VALUE_FIELD,
  getTransactionCustomTypeKey,
} from '../utils/constant.utils';
import { getPaymentTypesAvailability } from './webshop.service';
import { getBillPaymentExclusion } from './billPaymentRestriction.service';

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

const validateCartData = (cart: Cart, paymentType: ECTransactionPaymentType, ecConfig: { webShopId: string }) => {
  const errors: Errorx[] = [];

  validateAddresses(cart.billingAddress, getShippingAddress(cart), ecConfig, errors);
  validateCurrency(cart.totalPrice.currencyCode, ecConfig, errors);

  if (paymentType === ECTransactionPaymentType.ECTransactionBillPayment) {
    const shippingDestinations = getShippingDestinations(cart);

    validateShippingDestinations(cart.billingAddress, shippingDestinations, ecConfig, errors);
    validatePrivateCustomer(cart, shippingDestinations, ecConfig, errors);
  }

  if (errors.length > 0) {
    throw new MultiErrorx(errors);
  }
};

const validateAvailability = async (
  cart: Cart,
  amount: number,
  paymentType: ECTransactionPaymentType,
  ecConfig: { webShopId: string },
): Promise<PaymentTypesAvailability> => {
  const errors: Errorx[] = [];
  const availability = await getPaymentTypesAvailability(amount);
  // Installment requests skip the product type lookup; handlePaymentMethod applies it for the response.
  const paymentTypes =
    paymentType === ECTransactionPaymentType.ECTransactionBillPayment
      ? await applyBillPaymentExclusion(cart, availability)
      : availability;

  validatePaymentTypeAvailability(amount, paymentTypes[paymentType], ecConfig, errors);

  if (errors.length > 0) {
    throw new MultiErrorx(errors);
  }

  return paymentTypes;
};

// Throws a MultiErrorx if easyCredit cannot be offered for the cart
const validateCart = async (cart: Cart, paymentType: ECTransactionPaymentType): Promise<PaymentTypesAvailability> => {
  const ecConfig = { webShopId: readConfiguration().easyCredit.webShopId };
  const amount = convertCentsToEur(cart.totalPrice.centAmount, cart.totalPrice.fractionDigits);

  // The enabler hides bill payment only on availability errors, so they must win over cart errors that render an alert.
  if (paymentType === ECTransactionPaymentType.ECTransactionBillPayment) {
    const paymentTypes = await validateAvailability(cart, amount, paymentType, ecConfig);
    validateCartData(cart, paymentType, ecConfig);

    return paymentTypes;
  }

  validateCartData(cart, paymentType, ecConfig);

  return validateAvailability(cart, amount, paymentType, ecConfig);
};

// Not logged here: the error handler already logs every error it answers with.
export const handlePaymentMethod = async (
  cartId: string,
  paymentType: ECTransactionPaymentType = DEFAULT_PAYMENT_TYPE,
): Promise<GetPaymentMethodResponse> => {
  assertPaymentTypeEnabled(paymentType);
  const cart = await getCartById(cartId);
  const validated = await validateCart(cart, paymentType);
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
// HardFreeze keeps discounts and shipping fixed; a cart frozen softly must be unfrozen first.
const hardFreezeCart = async (cart: Cart): Promise<Cart> => {
  const isFrozen = cart.cartState === CTCartState.Frozen;
  if (isFrozen && cart.freezeStrategy === 'HardFreeze') {
    return cart;
  }

  return updateCart(cart, [
    ...(isFrozen ? [{ action: 'unfreezeCart' as const }] : []),
    { action: 'freezeCart', strategy: 'HardFreeze' },
  ]);
};

// Without a transaction the payment is an orphan on the cart. Unfreeze first, as removePayment on a frozen cart is undocumented.
const unfreezeAfterFailedCreate = async (cart: Cart, orphanPaymentId?: string): Promise<void> => {
  const orphanCleanup: CartUpdateAction[] = orphanPaymentId
    ? [{ action: 'removePayment', payment: { typeId: 'payment', id: orphanPaymentId } }]
    : [];

  try {
    await updateCart(cart, [{ action: 'unfreezeCart' }, ...orphanCleanup]);
  } catch (cleanupError: unknown) {
    log.error('Failed to unfreeze the cart after a failed payment creation', cleanupError);
  }
};

const getItemIds = ({ lineItems, customLineItems }: Cart): string =>
  [...lineItems, ...customLineItems].map(({ id }) => id).join(',');

export const handleCreatePayment = async (
  cartId: string,
  redirectLinks: ECTransactionRedirectLinksWithoutAuthorizationCallback,
  customerRelationship: ECTransactionCustomerRelationship,
  paymentType: ECTransactionPaymentType = DEFAULT_PAYMENT_TYPE,
): Promise<PaymentResponse> => {
  let cart: Cart | null = null;
  let shouldUnfreezeCart = false;
  // Id of a payment that is attached to the cart but has no transaction written yet
  const orphan: { paymentId?: string } = {};
  try {
    assertPaymentTypeEnabled(paymentType);
    cart = await getCartById(cartId);
    await validateCart(cart, paymentType);
    const { centAmount, currencyCode } = cart.totalPrice;
    const itemIds = getItemIds(cart);

    // After validation, so a rejected request leaves the cart untouched. It re-freezes with HardFreeze, and the
    // re-validation below covers an unfreeze that repriced the cart.
    cart = await discardStaleAttempts(cart);
    cart = await hardFreezeCart(cart);
    shouldUnfreezeCart = true;

    // Freezing can reprice the cart or add a 0 € gift line item, so the checks above may no longer hold.
    if (
      cart.totalPrice.centAmount !== centAmount ||
      cart.totalPrice.currencyCode !== currencyCode ||
      getItemIds(cart) !== itemIds
    ) {
      await validateCart(cart, paymentType);
    }

    const ctPayment = await createPayment(mapCTCartToCTPayment(cart, paymentType));
    cart = await updateCart(cart, [{ action: 'addPayment', payment: { typeId: 'payment', id: ctPayment.id } }]);
    orphan.paymentId = ctPayment.id;

    const ecPayment = await initEasyCreditClient().createPayment(
      await mapCTCartToECPayment(cart, ctPayment, redirectLinks, customerRelationship, paymentType),
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
    log.error('Error in handleCreatePayment', error);

    // Validation failures must leave even an already frozen cart untouched.
    if (shouldUnfreezeCart && cart?.cartState === CTCartState.Frozen) {
      await unfreezeAfterFailedCreate(cart, orphan.paymentId);
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
  { action: 'setMethodInfoMethod', method: paymentType },
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
const validateFinalType = async (paymentId: string, paymentType: ECTransactionPaymentType): Promise<void> => {
  let enabled = false;

  try {
    assertPaymentTypeEnabled(paymentType);
    enabled = true;
    await validateCart(await getCartByPaymentId(paymentId), paymentType);
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
    await validateFinalType(payment.id, final);
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
// With expectedFrom, a transaction that is in another state (an already failed one included) is left alone and its cart
// stays frozen: a newer attempt may hold it by now.
const failTransaction = async (paymentId: string, expectedFrom?: CTTransactionState): Promise<void> => {
  const outcome = await transitionTransaction(paymentId, CTTransactionState.Failure, expectedFrom);
  if (outcome === 'refused' || (expectedFrom && outcome === 'alreadyInState')) {
    return;
  }
  try {
    const cart = await getCartByPaymentId(paymentId);
    if (cart.cartState === CTCartState.Frozen) {
      await updateCart(cart, [{ action: 'unfreezeCart' }]);
    }
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
const discardStaleAttempts = async (cart: Cart): Promise<Cart> => {
  const discarded: string[] = [];

  for (const { id } of cart.paymentInfo?.payments ?? []) {
    const payment = await getPaymentById(id);

    if (payment.paymentMethodInfo.paymentInterface?.toLowerCase() === EASYCREDIT_PAYMENT_METHOD) {
      if (await isStaleAttempt(payment)) {
        discarded.push(id);
      }
    }
  }

  if (discarded.length === 0) {
    return cart;
  }

  for (const id of discarded) {
    // The attempt is no longer Initial (e.g. its authorization was written Pending), so it is no longer ours to remove.
    // Residual window: the authorize flow writes Pending only after its POST, so an attempt can still be Initial while
    // the request is out. It is then discarded here and handleAuthorizeECPayment logs EASYCREDIT_AUTHORIZATION_SENT_ATTEMPT_DISCARDED.
    if (!(await setTransactionState(id, CTTransactionState.Failure, CTTransactionState.Initial))) {
      throw paymentInProgressError();
    }
  }

  return updateCart(cart, [
    ...(cart.cartState === CTCartState.Frozen ? [{ action: 'unfreezeCart' as const }] : []),
    ...discarded.map((id) => ({ action: 'removePayment' as const, payment: { typeId: 'payment' as const, id } })),
    { action: 'freezeCart', strategy: 'HardFreeze' },
  ]);
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

// The cart must still be frozen and cart, transaction and easyCredit amounts must agree. Returns the cart it read.
// With expectedFrom, only a transaction that is still in that state is failed.
const assertAmountMatches = async (
  paymentId: string,
  ecPayment: ECGetPaymentResponse,
  expectedFrom?: CTTransactionState,
): Promise<Cart> => {
  const cart = await getCartByPaymentId(paymentId);
  const payment = await getPaymentById(paymentId);
  const transaction = getTransaction(payment) as Transaction;
  const ecValue = ecPayment.transaction?.orderDetails?.orderValue ?? ecPayment.decision?.orderValue;
  const ecCents = ecValue === undefined ? undefined : eurToCents(ecValue);

  if (
    cart.cartState !== CTCartState.Frozen ||
    ecCents === undefined ||
    cart.totalPrice.centAmount !== transaction.amount.centAmount ||
    cart.totalPrice.centAmount !== ecCents
  ) {
    await failTransaction(paymentId, expectedFrom);
    throw new Errorx({
      code: 'AmountMismatch',
      message: 'Der Warenkorb wurde nach der Zahlungsfreigabe geaendert. Die Zahlung wurde abgebrochen.',
      httpErrorStatus: 400,
      privateMessage: `AmountMismatch: cart ${cart.cartState} ${cart.totalPrice.centAmount}, transaction ${transaction.amount.centAmount}, easyCredit ${ecCents}`,
    });
  }

  return cart;
};

// A frozen cart still accepts address and company updates, so the bill rules can break after init.
// Only runs for an Initial transaction, so a concurrent authorize that wrote Pending keeps its attempt.
const assertBillRulesHold = async (paymentId: string, cart: Cart): Promise<void> => {
  try {
    validateCartData(cart, ECTransactionPaymentType.ECTransactionBillPayment, {
      webShopId: readConfiguration().easyCredit.webShopId,
    });
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
    await assertAmountMatches(paymentId, ecPayment);
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
      throw notAuthorizedError();
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
): Promise<void> => {
  const cart = await assertAmountMatches(paymentId, ecPayment, CTTransactionState.Initial);
  if (paymentType === ECTransactionPaymentType.ECTransactionBillPayment) {
    await assertBillRulesHold(paymentId, cart);
  }
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw authorizationTimeoutError();
  }
  await initEasyCreditClient().authorizePayment(technicalTransactionId, paymentId, AbortSignal.timeout(remaining));
  // The request is out, but the transaction was Initial until now: a concurrent create or switch may have discarded
  // it. A fast callback may have written Success already; the poll below then finishes at once.
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

export const handleAuthorizeECPayment = async (paymentId: string): Promise<void> => {
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
      throw notAuthorizedError();
    }
    if (ecPayment.status !== ECTransactionStatus.PREAUTHORIZED) {
      throw notPreauthorizedError();
    }

    const paymentType = await syncPaymentType(payment, ecPayment);

    if (transaction.state === CTTransactionState.Initial) {
      await requestAuthorization(paymentId, technicalTransactionId, ecPayment, paymentType, deadline);
    }

    await pollUntilAuthorized(paymentId, technicalTransactionId, deadline);
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

    const cart = await getCartByPaymentId(payment.id);

    await updateCart(cart, [{ action: 'unfreezeCart' }]);

    return paymentId;
  } catch (error) {
    log.error('Error in cancelling payment and unfreezing cart', error);
    throw error;
  }
};

export const handleCapturePayment = async (paymentId: string, trackingNumber?: string): Promise<void> => {
  try {
    const payment = await getPaymentById(paymentId);

    validatePayment(payment);
    validateSuccessTransaction(payment);

    const transaction = getSuccessTransaction(payment) as Transaction;
    const ecTechnicalTransactionId = transaction.custom?.fields.easyCreditTechnicalTransactionId as string;

    const easyCreditTransaction = await initEasyCreditClient().getPayment(ecTechnicalTransactionId);

    if (easyCreditTransaction.status !== ECTransactionStatus.AUTHORIZED) {
      throw new Errorx({
        code: 'TransactionIsNotAuthorized',
        message: 'You are not allow to capture a payment without Easy Credit AUTHORIZED transaction.',
        httpErrorStatus: 400,
      });
    }

    const response = await initEasyCreditClient().capturePayment(
      easyCreditTransaction.decision.transactionId,
      paymentId,
      trackingNumber,
    );

    if (response) {
      await updatePayment(payment, [
        {
          action: 'addTransaction',
          transaction: {
            type: CTTransactionType.Charge,
            state: CTTransactionState.Pending,
            amount: transaction.amount,
            interactionId: transaction.interactionId,
            timestamp: new Date().toISOString(),
            custom: transaction.custom,
          },
        },
      ]);
      log.info('Capture payment initiated successfully', { paymentId });
    }
  } catch (error) {
    log.error('Error in capturing payment', error);
    throw error;
  }
};

export const handleRefundPayment = async (paymentId: string, refundAmount: number): Promise<Payment> => {
  try {
    const payment = await getPaymentById(paymentId);

    validatePaymentAmount(payment, refundAmount);
    validatePayment(payment);
    validateSuccessTransaction(payment);

    const ecTransactionId = getSuccessTransaction(payment)?.interactionId as string;

    const updatedCTPayment = await updatePayment(payment, [
      {
        action: 'addTransaction',
        transaction: {
          type: CTTransactionType.Refund,
          state: CTTransactionState.Initial,
          amount: mapAmountToCTTransactionAmount(refundAmount),
        },
      },
    ]);

    const initialRefundTransaction = validateInitialRefundTransaction(updatedCTPayment);

    const refundPayload: ECRefundPayload = {
      value: refundAmount,
      bookingId: initialRefundTransaction.id,
    };

    const isSuccess = await initEasyCreditClient().refundPayment(ecTransactionId, refundPayload);

    let newState;
    if (isSuccess) {
      newState = CTTransactionState.Pending;
    } else {
      newState = CTTransactionState.Failure;
    }

    return await updatePayment(updatedCTPayment, [
      { action: 'changeTransactionState', transactionId: initialRefundTransaction.id, state: newState },
    ]);
  } catch (error) {
    log.error('Error in refunding payment', error);
    throw error;
  }
};
