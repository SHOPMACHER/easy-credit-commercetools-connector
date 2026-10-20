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
import { CartUpdateAction } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/cart';
import { log } from '../libs/logger';
import {
  validateAddresses,
  validateCurrency,
  validateInitialOrPendingTransaction,
  validateInitialRefundTransaction,
  validatePayment,
  validatePaymentAmount,
  validatePaymentTypeAvailability,
  validateSuccessTransaction,
  validateTransaction,
} from '../validators/payment.validators';
import { createPayment, getPaymentById, updatePayment } from '../commercetools/payment.commercetools';
import { getPaymentType, getSuccessTransaction, getTransaction } from '../utils/payment.utils';
import { initEasyCreditClient } from '../client/easycredit.client';
import {
  getShippingAddress,
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
  getTransactionCustomTypeKey,
} from '../utils/constant.utils';
import { getPaymentTypesAvailability } from './webshop.service';
import { getBillPaymentExclusion } from './billPaymentRestriction.service';

// handlePaymentMethod and callers that omit a type stay on installment.
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

// Throws a MultiErrorx if easyCredit cannot be offered for the cart
const validateCart = async (
  cart: Cart,
  paymentType: ECTransactionPaymentType = DEFAULT_PAYMENT_TYPE,
): Promise<PaymentTypesAvailability> => {
  const ecConfig = { webShopId: readConfiguration().easyCredit.webShopId };
  const errors: Errorx[] = [];

  const billingAddress = cart.billingAddress;
  const shippingAddress = getShippingAddress(cart);

  validateAddresses(billingAddress, shippingAddress, ecConfig, errors);
  validateCurrency(cart.totalPrice.currencyCode, ecConfig, errors);

  if (errors.length > 0) {
    throw new MultiErrorx(errors);
  }

  const amount = convertCentsToEur(cart.totalPrice.centAmount, cart.totalPrice.fractionDigits);
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

export const handlePaymentMethod = async (cartId: string): Promise<GetPaymentMethodResponse> => {
  try {
    const cart = await getCartById(cartId);
    const paymentTypes = await applyBillPaymentExclusion(cart, await validateCart(cart));

    return {
      webShopId: readConfiguration().easyCredit.webShopId,
      amount: convertCentsToEur(cart.totalPrice.centAmount, cart.totalPrice.fractionDigits),
      paymentTypes,
    };
  } catch (error: unknown) {
    log.error('Error in getting EasyCredit Payment Method', error);
    throw error;
  }
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
    cart = await getCartById(cartId);
    await validateCart(cart, paymentType);
    const { centAmount, currencyCode } = cart.totalPrice;
    const itemIds = getItemIds(cart);

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

export const handleGetPayment = async (paymentId: string): Promise<GetPaymentResponse> => {
  try {
    const payment = await getPaymentById(paymentId);

    validatePayment(payment);
    validateTransaction(payment);

    const transaction = getTransaction(payment) as Transaction;
    const ecTechnicalTransactionId = transaction.custom?.fields.easyCreditTechnicalTransactionId as string;

    const ecPayment = await initEasyCreditClient().getPayment(ecTechnicalTransactionId);

    return {
      ...ecPayment,
      paymentType: getPaymentType(payment),
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

// Sets the authorization transaction state, retrying once on a 409 version conflict.
// Returns true when the transaction is in the requested state afterwards, false when the transition is not allowed.
const setTransactionState = async (paymentId: string, state: CTTransactionState): Promise<boolean> => {
  for (let attempt = 0; ; attempt++) {
    const payment = await getPaymentById(paymentId);
    const transaction = getTransaction(payment) as Transaction;
    if (transaction.state === state) {
      return true;
    }
    if (!ALLOWED_TRANSITIONS[transaction.state as CTTransactionState]?.includes(state)) {
      log.warn('Refused an invalid transaction state transition', {
        paymentId,
        currentState: transaction.state,
        requestedState: state,
      });
      return false;
    }
    try {
      await updatePayment(payment, [{ action: 'changeTransactionState', transactionId: transaction.id, state }]);
      return true;
    } catch (error: unknown) {
      if (attempt > 0 || (error as Errorx).httpErrorStatus !== 409) {
        throw error;
      }
    }
  }
};

// A Success transaction is never failed and its cart stays frozen for the order.
const failTransaction = async (paymentId: string): Promise<void> => {
  if (!(await setTransactionState(paymentId, CTTransactionState.Failure))) {
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

// The cart must still be frozen and cart, transaction and easyCredit amounts must agree.
const assertAmountMatches = async (paymentId: string, ecPayment: ECGetPaymentResponse): Promise<void> => {
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
    await failTransaction(paymentId);
    throw new Errorx({
      code: 'AmountMismatch',
      message: 'Der Warenkorb wurde nach der Zahlungsfreigabe geaendert. Die Zahlung wurde abgebrochen.',
      httpErrorStatus: 400,
      privateMessage: `AmountMismatch: cart ${cart.cartState} ${cart.totalPrice.centAmount}, transaction ${transaction.amount.centAmount}, easyCredit ${ecCents}`,
    });
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
      return await finalizeSuccess(paymentId, technicalTransactionId, ecPayment);
    }
    if (AUTHORIZATION_DECLINED_STATUSES.includes(ecPayment.status)) {
      await failTransaction(paymentId);
      throw notAuthorizedError();
    }
    if (ecPayment.status !== ECTransactionStatus.PREAUTHORIZED) {
      throw notPreauthorizedError();
    }

    if (transaction.state === CTTransactionState.Initial) {
      await assertAmountMatches(paymentId, ecPayment);
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw authorizationTimeoutError();
      }
      await initEasyCreditClient().authorizePayment(technicalTransactionId, paymentId, AbortSignal.timeout(remaining));
      await setTransactionState(paymentId, CTTransactionState.Pending);
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
      return await finalizeSuccess(paymentId, ecTechnicalTransactionId, ecPayment);
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

    const easyCreditTransaction = await initEasyCreditClient().getPayment(ecTechnicalTransactionId);

    if (easyCreditTransaction.status === ECTransactionStatus.AUTHORIZED) {
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
