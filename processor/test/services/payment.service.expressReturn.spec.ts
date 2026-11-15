import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fastify from 'fastify';
import { Cart, Errorx, MultiErrorx, Payment } from '@commercetools/connect-payments-sdk';
import { CartUpdateAction, PaymentUpdateAction, ShippingMethod } from '@commercetools/platform-sdk';
import { handleAuthorizeECPayment, handleExpressReturn } from '../../src/services/payment.service';
import { resetWebshopInfoCache } from '../../src/services/webshop.service';
import {
  findCartByPaymentId,
  getCartById,
  getCartByPaymentId,
  updateCart,
} from '../../src/commercetools/cart.commercetools';
import { getPaymentById, updatePayment } from '../../src/commercetools/payment.commercetools';
import { getMatchingShippingMethods } from '../../src/commercetools/shippingMethod.commercetools';
import { initEasyCreditClient } from '../../src/client/easycredit.client';
import { ECOutcomeUnknownError } from '../../src/client/easycredit.errors';
import { getCartIdFromContext } from '../../src/libs/fastify/context/context';
import { log } from '../../src/libs/logger';
import { paymentsRoute } from '../../src/routes/payment.route';
import { errorHandler } from '../../src/libs/fastify/error-handler';
import { ECGetPaymentResponse, ECTransactionPaymentType, ECTransactionSummary } from '../../src/types/payment.types';

// Runs the real service, validators and mappers against a stateful fake of commercetools and easyCredit.
jest.mock('../../src/commercetools/cart.commercetools');
jest.mock('../../src/commercetools/payment.commercetools');
jest.mock('../../src/commercetools/shippingMethod.commercetools');
jest.mock('../../src/commercetools/productType.commercetools');
jest.mock('../../src/client/easycredit.client');
jest.mock('../../src/libs/fastify/context/context', () => ({
  ...jest.requireActual<object>('../../src/libs/fastify/context/context'),
  getCartIdFromContext: jest.fn(),
}));

const webshopInfo = {
  availability: true,
  installmentPaymentActive: true,
  minInstallmentValue: 200,
  maxInstallmentValue: 10000,
  billPaymentActive: true,
  minBillingValue: 50,
  maxBillingValue: 5000,
};

// Shopper data on the easyCredit side. Birth date and IBAN must never reach commercetools or the logs.
const BIRTH_DATE = '1972-04-05';
const IBAN = 'DE12500105170648489890';
const ecShippingAddress = {
  firstName: 'Ralf',
  lastName: 'Ratenkauf',
  address: 'Beuthener Str. 25',
  zip: '90471',
  city: 'Nürnberg',
  country: 'DE',
};
const ctAddress = {
  firstName: 'Ralf',
  lastName: 'Ratenkauf',
  streetName: 'Beuthener Str.',
  streetNumber: '25',
  postalCode: '90471',
  city: 'Nürnberg',
  country: 'DE',
  phone: '+491712345678',
  mobile: '+491712345678',
};

const SHIPPING_COSTS: Record<string, number> = { standard: 495, free: 0, express: 1290 };

type State = { cart: Cart; payment: Payment };
let state: State;
let ecPayment: ECGetPaymentResponse;
let getECPayment: jest.Mock;
let updateECPayment: jest.Mock<(id: string, payload: { orderValue: number }) => Promise<ECTransactionSummary>>;
let authorizeECPayment: jest.Mock;

const item = (centAmount: number) => ({
  productType: { typeId: 'product-type', id: 'pt-physical' },
  name: { de: 'Stuhl' },
  quantity: 1,
  price: { value: { centAmount, fractionDigits: 2 } },
  variant: { sku: 'sku-1' },
});

const buildCart = (itemCents: number, overrides: Record<string, unknown> = {}): Cart =>
  ({
    id: 'session-cart',
    version: 1,
    cartState: 'Frozen',
    shippingMode: 'Single',
    shipping: [],
    shippingAddress: { country: 'DE' },
    lineItems: [item(itemCents)],
    customLineItems: [],
    itemShippingAddresses: [],
    paymentInfo: { payments: [{ typeId: 'payment', id: 'payment123' }] },
    totalPrice: { type: 'centPrecision', currencyCode: 'EUR', centAmount: itemCents, fractionDigits: 2 },
    ...overrides,
  }) as unknown as Cart;

const buildPayment = (cents: number, overrides: Record<string, unknown> = {}): Payment =>
  ({
    id: 'payment123',
    version: 1,
    amountPlanned: { currencyCode: 'EUR', centAmount: cents, fractionDigits: 2 },
    paymentMethodInfo: { paymentInterface: 'easycredit', method: 'easycredit' },
    custom: { type: { typeId: 'type', id: 'payment-type-id' }, fields: { easyCreditExpress: true } },
    transactions: [
      {
        id: 'tx-1',
        type: 'Authorization',
        state: 'Initial',
        amount: { currencyCode: 'EUR', centAmount: cents, fractionDigits: 2 },
        interactionId: 'ec-tx-1',
        custom: {
          type: { typeId: 'type', id: 'transaction-type-id' },
          fields: { easyCreditTechnicalTransactionId: 'tech123' },
        },
      },
    ],
    ...overrides,
  }) as unknown as Payment;

const buildECPayment = (orderValue: number, overrides: Partial<ECGetPaymentResponse> = {}): ECGetPaymentResponse =>
  ({
    status: 'PREAUTHORIZED',
    decision: {
      transactionId: 'ec-tx-1',
      orderValue,
      interest: 12.5,
      totalValue: orderValue + 12.5,
      decisionOutcome: 'POSITIVE',
    },
    transaction: {
      financingTerm: 12,
      paymentType: 'INSTALLMENT_PAYMENT',
      orderDetails: { orderValue, orderId: 'payment123', shippingAddress: ecShippingAddress, invoiceAddress: null },
      customer: {
        firstName: 'Ralf',
        lastName: 'Ratenkauf',
        birthDate: BIRTH_DATE,
        contact: { email: 'ralf@example.com', mobilePhoneNumber: '+491712345678' },
        bank: { iban: IBAN },
      },
    },
    ...overrides,
  }) as unknown as ECGetPaymentResponse;

const summary = (orderValue: number, decisionOutcome = 'POSITIVE'): ECTransactionSummary =>
  ({
    transactionId: 'ec-tx-1',
    orderValue,
    interest: 13.1,
    totalValue: orderValue + 13.1,
    decisionOutcome,
  }) as ECTransactionSummary;

// What easyCredit answers for a transaction 30 minutes after the last activity.
const expiredError = () =>
  new Errorx({
    code: 'CONSTRAINT_VIOLATION',
    message: 'CONSTRAINT_VIOLATION',
    httpErrorStatus: 400,
    fields: [{ field: 'decision', message: 'The decision for transaction with id tech123 is invalid' }],
  });

const applyCartAction = (cart: Cart, action: CartUpdateAction): Cart => {
  switch (action.action) {
    case 'setShippingAddress':
      return { ...cart, shippingAddress: action.address } as Cart;
    case 'setBillingAddress':
      return { ...cart, billingAddress: action.address } as Cart;
    case 'setCustomerEmail':
      return { ...cart, customerEmail: action.email };
    case 'setShippingMethod': {
      const id = action.shippingMethod?.id as string;
      const itemsTotal = cart.lineItems.reduce((sum, { price }) => sum + price.value.centAmount, 0);
      return {
        ...cart,
        shippingInfo: { shippingMethod: { typeId: 'shipping-method', id } },
        totalPrice: { ...cart.totalPrice, centAmount: itemsTotal + SHIPPING_COSTS[id] },
      } as unknown as Cart;
    }
    case 'unfreezeCart':
      return { ...cart, cartState: 'Active' };
    default:
      return cart;
  }
};

const applyPaymentAction = (payment: Payment, action: PaymentUpdateAction): Payment => {
  switch (action.action) {
    case 'changeTransactionState':
      return {
        ...payment,
        transactions: payment.transactions.map((transaction) =>
          transaction.id === action.transactionId ? { ...transaction, state: action.state } : transaction,
        ),
      };
    case 'addTransaction':
      return {
        ...payment,
        transactions: [
          // commercetools does not specify the array order, so the new transaction goes first here.
          {
            ...action.transaction,
            id: `tx-${payment.transactions.length + 1}`,
          } as unknown as Payment['transactions'][number],
          ...payment.transactions,
        ],
      };
    case 'changeAmountPlanned':
      return {
        ...payment,
        amountPlanned: { ...payment.amountPlanned, centAmount: action.amount.centAmount as number },
      };
    case 'setTransactionCustomField':
      return {
        ...payment,
        transactions: payment.transactions.map((transaction) =>
          transaction.id === action.transactionId
            ? ({
                ...transaction,
                custom: {
                  ...transaction.custom,
                  fields: { ...transaction.custom?.fields, [action.name]: action.value },
                },
              } as typeof transaction)
            : transaction,
        ),
      };
    default:
      return payment;
  }
};

const setup = ({ cart, payment, ec }: { cart: Cart; payment: Payment; ec: ECGetPaymentResponse }) => {
  state = { cart, payment };
  ecPayment = ec;
  jest.mocked(getCartIdFromContext).mockReturnValue('session-cart');
  jest.mocked(getCartById).mockImplementation(async () => state.cart);
  jest.mocked(getCartByPaymentId).mockImplementation(async () => state.cart);
  jest.mocked(findCartByPaymentId).mockImplementation(async () => state.cart);
  jest.mocked(updateCart).mockImplementation(async (_cart, actions) => {
    state.cart = actions.reduce(applyCartAction, { ...state.cart, version: state.cart.version + 1 });
    return state.cart;
  });
  jest.mocked(getPaymentById).mockImplementation(async () => state.payment);
  jest.mocked(updatePayment).mockImplementation(async (current, actions) => {
    if (current.version !== state.payment.version) {
      throw new Errorx({ code: 'ConcurrentModification', message: 'version', httpErrorStatus: 409 });
    }
    state.payment = actions.reduce(applyPaymentAction, { ...state.payment, version: state.payment.version + 1 });
    return state.payment;
  });
  jest
    .mocked(getMatchingShippingMethods)
    .mockResolvedValue([{ id: 'standard' }, { id: 'express' }, { id: 'free' }] as ShippingMethod[]);
};

const authorization = (status: string) =>
  state.payment.transactions.filter(({ type, state: s }) => type === 'Authorization' && s === status);

const getErrorCodes = async (promise: Promise<unknown>) => {
  const error = await promise.catch((error: unknown) => error);

  if (error instanceof MultiErrorx) {
    return error.errors.map(({ code }) => code);
  }
  if (error instanceof Errorx) {
    return [error.code];
  }

  throw new Error(`Expected an Errorx or MultiErrorx, got ${String(error)}`);
};

// A cancel webhook that completes while the request awaits the limits: the attempt fails and the cart is released.
const cancelDuringValidation = () => {
  const webshop = initEasyCreditClient() as unknown as { getWebshopInfo: jest.Mock };
  webshop.getWebshopInfo.mockImplementationOnce(async () => {
    state.payment = applyPaymentAction(
      { ...state.payment, version: state.payment.version + 1 },
      { action: 'changeTransactionState', transactionId: 'tx-1', state: 'Failure' },
    );
    state.cart = applyCartAction({ ...state.cart, version: state.cart.version + 1 }, { action: 'unfreezeCart' });
    return webshopInfo;
  });
};

const expectAbandoned = () => {
  expect(authorization('Initial')).toHaveLength(0);
  expect(state.cart.cartState).toBe('Active');
};

beforeEach(() => {
  jest.clearAllMocks();
  resetWebshopInfoCache();
  getECPayment = jest.fn(async () => ecPayment);
  updateECPayment = jest.fn(async (_id: string, payload: { orderValue: number }) => summary(payload.orderValue));
  authorizeECPayment = jest.fn(async () => true);
  (initEasyCreditClient as jest.Mock).mockReturnValue({
    getWebshopInfo: jest.fn(async () => webshopInfo),
    getPayment: getECPayment,
    updatePayment: updateECPayment,
    authorizePayment: authorizeECPayment,
  });
});

describe('handleExpressReturn', () => {
  it('should take over the guest data, set the default shipping method and patch the new total', async () => {
    setup({ cart: buildCart(50000), payment: buildPayment(50000), ec: buildECPayment(500) });

    const response = await handleExpressReturn('session-cart', 'payment123');

    expect(updateCart).toHaveBeenCalledWith(expect.anything(), [
      { action: 'setShippingAddress', address: ctAddress },
      { action: 'setBillingAddress', address: ctAddress },
      { action: 'setCustomerEmail', email: 'ralf@example.com' },
    ]);
    expect(state.cart.shippingInfo?.shippingMethod?.id).toBe('standard');
    expect(updateECPayment).toHaveBeenCalledWith(
      'tech123',
      {
        orderValue: 504.95,
        numberOfProductsInShoppingCart: 1,
        shoppingCartInformation: [
          { productName: 'Stuhl', quantity: 1, price: 500, articleNumber: [{ numberType: 'GTIN', number: 'sku-1' }] },
        ],
      },
      undefined,
    );
    expect(response).toMatchObject({
      status: 'PREAUTHORIZED',
      amount: 504.95,
      decision: { orderValue: 504.95, interest: 13.1, decisionOutcome: 'POSITIVE' },
    });
  });

  it('should replace the authorization transaction with one for the new amount', async () => {
    setup({ cart: buildCart(50000), payment: buildPayment(50000), ec: buildECPayment(500) });

    await handleExpressReturn('session-cart', 'payment123');

    const [failed] = authorization('Failure');
    const [replacement] = authorization('Initial');
    expect(failed).toMatchObject({ id: 'tx-1', amount: { centAmount: 50000 } });
    expect(replacement).toMatchObject({
      amount: { centAmount: 50495, currencyCode: 'EUR' },
      interactionId: 'ec-tx-1',
      custom: {
        type: { typeId: 'type', id: 'transaction-type-id' },
        fields: { easyCreditTechnicalTransactionId: 'tech123', easyCreditInterest: 13.1, easyCreditTotalValue: 518.05 },
      },
    });
    expect(state.payment.amountPlanned.centAmount).toBe(50495);
    expect(state.cart.cartState).toBe('Frozen');
  });

  it('should keep the account email of a logged-in customer', async () => {
    setup({
      cart: buildCart(50000, { customerId: 'customer-1', customerEmail: 'account@example.com' }),
      payment: buildPayment(50000),
      ec: buildECPayment(500),
    });

    await handleExpressReturn('session-cart', 'payment123');

    expect(updateCart).toHaveBeenCalledWith(expect.anything(), [
      { action: 'setShippingAddress', address: ctAddress },
      { action: 'setBillingAddress', address: ctAddress },
    ]);
    expect(state.cart.customerEmail).toBe('account@example.com');
  });

  it('should not patch the transaction when the total did not change', async () => {
    setup({ cart: buildCart(50000), payment: buildPayment(50000), ec: buildECPayment(500) });
    jest.mocked(getMatchingShippingMethods).mockResolvedValue([{ id: 'free' }] as ShippingMethod[]);

    const response = await handleExpressReturn('session-cart', 'payment123');

    expect(updateECPayment).not.toHaveBeenCalled();
    expect(authorization('Initial')).toMatchObject([{ id: 'tx-1' }]);
    expect(response).toMatchObject({ amount: 500, decision: { orderValue: 500, interest: 12.5 } });
  });

  it('should keep a matching shipping method the shopper already chose', async () => {
    setup({
      cart: buildCart(50000, { shippingInfo: { shippingMethod: { typeId: 'shipping-method', id: 'express' } } }),
      payment: buildPayment(50000),
      ec: buildECPayment(500),
    });

    await handleExpressReturn('session-cart', 'payment123');

    expect(updateCart).toHaveBeenCalledWith(expect.anything(), [
      { action: 'setShippingMethod', shippingMethod: { typeId: 'shipping-method', id: 'express' } },
    ]);
    expect(updateECPayment).toHaveBeenCalledWith('tech123', expect.objectContaining({ orderValue: 512.9 }), undefined);
  });

  it('should patch a lower total too', async () => {
    setup({ cart: buildCart(50000), payment: buildPayment(51000), ec: buildECPayment(510) });

    await handleExpressReturn('session-cart', 'payment123');

    expect(updateECPayment).toHaveBeenCalledWith('tech123', expect.objectContaining({ orderValue: 504.95 }), undefined);
  });

  it('should be repeatable: a second return finds the synced amount and patches nothing', async () => {
    setup({ cart: buildCart(50000), payment: buildPayment(50000), ec: buildECPayment(500) });
    await handleExpressReturn('session-cart', 'payment123');
    ecPayment = buildECPayment(504.95);

    await handleExpressReturn('session-cart', 'payment123');

    expect(updateECPayment).toHaveBeenCalledTimes(1);
    expect(authorization('Initial')).toHaveLength(1);
  });

  it.each([
    ['OPEN', 'TransactionNotPreauthorized'],
    ['DECLINED', 'TransactionNotPreauthorized'],
    ['EXPIRED', 'TransactionExpired'],
  ])('should abandon the attempt when easyCredit reports %s', async (status, code) => {
    setup({
      cart: buildCart(50000),
      payment: buildPayment(50000),
      ec: buildECPayment(500, { status } as Partial<ECGetPaymentResponse>),
    });

    expect(await getErrorCodes(handleExpressReturn('session-cart', 'payment123'))).toEqual([code]);
    expectAbandoned();
    expect(state.cart.billingAddress).toBeUndefined();
  });

  it.each([
    ['expired (400 on the decision)', expiredError()],
    ['gone (404)', new Errorx({ code: 'NotFound', message: 'not found', httpErrorStatus: 404 })],
    ['gone (410)', new Errorx({ code: 'Gone', message: 'gone', httpErrorStatus: 410 })],
  ])('should abandon the attempt when the transaction is %s at easyCredit', async (_case, error) => {
    setup({ cart: buildCart(50000), payment: buildPayment(50000), ec: buildECPayment(500) });
    getECPayment.mockImplementation(async () => {
      throw error;
    });

    expect(await getErrorCodes(handleExpressReturn('session-cart', 'payment123'))).toEqual(['TransactionExpired']);
    expectAbandoned();
    expect(state.cart.billingAddress).toBeUndefined();
  });

  it('should leave the attempt open when easyCredit cannot be reached', async () => {
    setup({ cart: buildCart(50000), payment: buildPayment(50000), ec: buildECPayment(500) });
    getECPayment.mockImplementation(async () => {
      throw new Errorx({ code: 'ServiceUnavailable', message: 'down', httpErrorStatus: 503 });
    });

    expect(await getErrorCodes(handleExpressReturn('session-cart', 'payment123'))).toEqual(['ServiceUnavailable']);
    expect(authorization('Initial')).toHaveLength(1);
    expect(state.cart.cartState).toBe('Frozen');
  });

  it('should abandon the attempt on a negative decision', async () => {
    const ec = buildECPayment(500);
    setup({
      cart: buildCart(50000),
      payment: buildPayment(50000),
      ec: { ...ec, decision: { ...ec.decision, decisionOutcome: 'NEGATIVE' } },
    });

    expect(await getErrorCodes(handleExpressReturn('session-cart', 'payment123'))).toEqual(['DecisionNotPositive']);
    expectAbandoned();
  });

  it('should abandon the attempt when the PATCH answers with a negative decision', async () => {
    setup({ cart: buildCart(50000), payment: buildPayment(50000), ec: buildECPayment(500) });
    updateECPayment.mockImplementation(async () => summary(504.95, 'NEGATIVE'));

    expect(await getErrorCodes(handleExpressReturn('session-cart', 'payment123'))).toEqual(['DecisionNotPositive']);
    expectAbandoned();
    expect(authorization('Failure')).toMatchObject([{ id: 'tx-1' }]);
  });

  it.each([
    [
      'rejected for an increase',
      500,
      new Errorx({ code: 'CONSTRAINT_VIOLATION', message: 'Increase not possible', httpErrorStatus: 400 }),
      'AmountIncreaseNotPossible',
    ],
    [
      'rejected for a decrease',
      510,
      new Errorx({ code: 'CONSTRAINT_VIOLATION', message: 'Invalid', httpErrorStatus: 400 }),
      'CONSTRAINT_VIOLATION',
    ],
    [
      'timed out',
      500,
      new ECOutcomeUnknownError({ code: 'TransactionUpdateFailed', message: 'failed', httpErrorStatus: 504 }),
      'TransactionUpdateFailed',
    ],
  ])('should abandon the attempt when the PATCH is %s', async (_case, ecOrderValue, error, code) => {
    setup({ cart: buildCart(50000), payment: buildPayment(50000), ec: buildECPayment(ecOrderValue) });
    updateECPayment.mockImplementation(async () => {
      throw error;
    });

    expect(await getErrorCodes(handleExpressReturn('session-cart', 'payment123'))).toEqual([code]);
    expectAbandoned();
  });

  it('should keep the attempt when a concurrent call replaced the transaction first, and sync it on a retry', async () => {
    setup({ cart: buildCart(50000), payment: buildPayment(50000), ec: buildECPayment(500) });
    // The other call wins the race for the version and writes the replacement first.
    const write = jest.mocked(updatePayment).getMockImplementation() as typeof updatePayment;
    let raced = false;
    jest.mocked(updatePayment).mockImplementation(async (current, actions) => {
      if (!raced && actions.some(({ action }) => action === 'addTransaction')) {
        raced = true;
        throw new Errorx({ code: 'ConcurrentModification', message: 'version', httpErrorStatus: 409 });
      }
      return write(current, actions);
    });

    expect(await getErrorCodes(handleExpressReturn('session-cart', 'payment123'))).toEqual(['ConcurrentModification']);
    expect(authorization('Initial')).toMatchObject([{ id: 'tx-1', amount: { centAmount: 50000 } }]);
    expect(state.cart.cartState).toBe('Frozen');

    // easyCredit kept the PATCH, so the retry only replaces the commercetools transaction.
    ecPayment = buildECPayment(504.95);
    await handleExpressReturn('session-cart', 'payment123');

    expect(updateECPayment).toHaveBeenCalledTimes(1);
    expect(authorization('Initial')).toMatchObject([{ amount: { centAmount: 50495 } }]);
  });

  it('should not revive an attempt that a concurrent cancel failed', async () => {
    setup({ cart: buildCart(50000), payment: buildPayment(50000), ec: buildECPayment(500) });
    cancelDuringValidation();

    expect(await getErrorCodes(handleExpressReturn('session-cart', 'payment123'))).toEqual([
      'TransactionNotPreauthorized',
    ]);
    expect(updateECPayment).not.toHaveBeenCalled();
    expect(updatePayment).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ action: 'addTransaction' })]),
    );
    expectAbandoned();
  });

  it('should prefer the default shipping method over the first match', async () => {
    setup({ cart: buildCart(50000), payment: buildPayment(50000), ec: buildECPayment(500) });
    jest
      .mocked(getMatchingShippingMethods)
      .mockResolvedValue([{ id: 'express' }, { id: 'free', isDefault: true }] as ShippingMethod[]);

    await handleExpressReturn('session-cart', 'payment123');

    expect(state.cart.shippingInfo?.shippingMethod?.id).toBe('free');
    expect(updateECPayment).not.toHaveBeenCalled();
  });

  describe('for a cart the shop froze with HardFreeze', () => {
    const hardFrozen = (shippingMethodId?: string) =>
      buildCart(50000, {
        freezeStrategy: 'HardFreeze',
        ...(shippingMethodId && {
          shippingInfo: { shippingMethod: { typeId: 'shipping-method', id: shippingMethodId } },
        }),
        totalPrice: { type: 'centPrecision', currencyCode: 'EUR', centAmount: 50495, fractionDigits: 2 },
      });

    it('should keep a matching shipping method without setting it again', async () => {
      setup({ cart: hardFrozen('standard'), payment: buildPayment(50495), ec: buildECPayment(504.95) });

      await handleExpressReturn('session-cart', 'payment123');

      expect(updateCart).toHaveBeenCalledTimes(1);
      expect(updateCart).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([expect.objectContaining({ action: 'setShippingMethod' })]),
      );
      expect(authorization('Initial')).toHaveLength(1);
    });

    it('should abandon the attempt when the shipping method would have to change', async () => {
      setup({ cart: hardFrozen(), payment: buildPayment(50495), ec: buildECPayment(504.95) });

      expect(await getErrorCodes(handleExpressReturn('session-cart', 'payment123'))).toEqual([
        'ShippingMethodNotChangeable',
      ]);
      expectAbandoned();
    });
  });

  it('should abandon the attempt when the new total exceeds the limit, without a PATCH', async () => {
    setup({ cart: buildCart(999900), payment: buildPayment(999900), ec: buildECPayment(9999) });

    expect(await getErrorCodes(handleExpressReturn('session-cart', 'payment123'))).toEqual(['InvalidAmount']);
    expect(updateECPayment).not.toHaveBeenCalled();
    expectAbandoned();
  });

  it('should abandon the attempt when no shipping method matches the address', async () => {
    setup({ cart: buildCart(50000), payment: buildPayment(50000), ec: buildECPayment(500) });
    jest.mocked(getMatchingShippingMethods).mockResolvedValue([]);

    expect(await getErrorCodes(handleExpressReturn('session-cart', 'payment123'))).toEqual(['NoShippingMethod']);
    expectAbandoned();
  });

  it('should reject an address outside Germany before it is written to the cart', async () => {
    const ec = buildECPayment(500);
    ec.transaction.orderDetails.shippingAddress = { ...ecShippingAddress, country: 'AT', zip: '10100' };
    setup({ cart: buildCart(50000), payment: buildPayment(50000), ec });

    expect(await getErrorCodes(handleExpressReturn('session-cart', 'payment123'))).toEqual(['AddressesUnmatched']);
    expect(updateCart).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ action: 'setShippingAddress' })]),
    );
    expectAbandoned();
  });

  it('should reject an invoice address that differs from the shipping address', async () => {
    const ec = buildECPayment(500);
    ec.transaction.orderDetails.invoiceAddress = { ...ecShippingAddress, address: 'Andere Str. 1' };
    setup({ cart: buildCart(50000), payment: buildPayment(50000), ec });

    expect(await getErrorCodes(handleExpressReturn('session-cart', 'payment123'))).toEqual(['AddressesUnmatched']);
    expectAbandoned();
  });

  it('should accept an invoice address without names at the same location', async () => {
    const ec = buildECPayment(500);
    ec.transaction.orderDetails.invoiceAddress = {
      address: 'Beuthener  Str. 25',
      zip: '90471',
      city: 'Nürnberg',
      country: 'DE',
    };
    setup({ cart: buildCart(50000), payment: buildPayment(50000), ec });

    await handleExpressReturn('session-cart', 'payment123');

    expect(state.cart.billingAddress).toEqual(ctAddress);
  });

  it('should abandon the attempt when easyCredit sends no shipping address', async () => {
    const ec = buildECPayment(500);
    ec.transaction.orderDetails.shippingAddress = null;
    setup({ cart: buildCart(50000), payment: buildPayment(50000), ec });

    expect(await getErrorCodes(handleExpressReturn('session-cart', 'payment123'))).toEqual(['InvalidShippingAddress']);
    expectAbandoned();
  });

  it('should reject a payment that is not attached to the session cart and leave it alone', async () => {
    setup({
      cart: buildCart(50000, { paymentInfo: { payments: [{ typeId: 'payment', id: 'other' }] } }),
      payment: buildPayment(50000),
      ec: buildECPayment(500),
    });

    expect(await getErrorCodes(handleExpressReturn('session-cart', 'payment123'))).toEqual(['InvalidSession']);
    expect(getECPayment).not.toHaveBeenCalled();
    expect(authorization('Initial')).toHaveLength(1);
  });

  it('should reject a session without a cart', async () => {
    expect(await getErrorCodes(handleExpressReturn(undefined, 'payment123'))).toEqual(['InvalidSession']);
    expect(getCartById).not.toHaveBeenCalled();
  });

  it('should reject a payment that was not started as express', async () => {
    setup({ cart: buildCart(50000), payment: buildPayment(50000, { custom: undefined }), ec: buildECPayment(500) });

    expect(await getErrorCodes(handleExpressReturn('session-cart', 'payment123'))).toEqual(['NotExpressPayment']);
    expect(getECPayment).not.toHaveBeenCalled();
  });

  it('should reject a payment whose authorization is already requested, without failing it', async () => {
    const payment = buildPayment(50000);
    (payment.transactions[0] as { state: string }).state = 'Pending';
    setup({ cart: buildCart(50000), payment, ec: buildECPayment(500) });

    expect(await getErrorCodes(handleExpressReturn('session-cart', 'payment123'))).toEqual([
      'TransactionNotPreauthorized',
    ]);
    expect(authorization('Pending')).toHaveLength(1);
  });

  it('should leave the attempt open on a transient commercetools error', async () => {
    setup({ cart: buildCart(50000), payment: buildPayment(50000), ec: buildECPayment(500) });
    jest
      .mocked(updateCart)
      .mockRejectedValueOnce(new Errorx({ code: 'ConcurrentModification', message: 'version', httpErrorStatus: 409 }));

    expect(await getErrorCodes(handleExpressReturn('session-cart', 'payment123'))).toEqual(['ConcurrentModification']);
    expect(authorization('Initial')).toHaveLength(1);
    expect(state.cart.cartState).toBe('Frozen');
  });

  it('should reject an already authorized transaction without failing it', async () => {
    setup({
      cart: buildCart(50000),
      payment: buildPayment(50000),
      ec: buildECPayment(500, { status: 'AUTHORIZED' } as Partial<ECGetPaymentResponse>),
    });

    expect(await getErrorCodes(handleExpressReturn('session-cart', 'payment123'))).toEqual([
      'TransactionNotPreauthorized',
    ]);
    expect(authorization('Initial')).toHaveLength(1);
  });

  it('should abandon the attempt for a cart with multiple shipping addresses', async () => {
    setup({
      cart: buildCart(50000, { shippingMode: 'Multiple' }),
      payment: buildPayment(50000),
      ec: buildECPayment(500),
    });

    expect(await getErrorCodes(handleExpressReturn('session-cart', 'payment123'))).toEqual([
      'ShippingModeNotSupported',
    ]);
    expectAbandoned();
  });

  it('should leave a bill payment open when the limits cannot be read', async () => {
    const ec = buildECPayment(500);
    ec.transaction.paymentType = ECTransactionPaymentType.ECTransactionBillPayment;
    setup({
      cart: buildCart(50000),
      payment: buildPayment(50000, { paymentMethodInfo: { paymentInterface: 'easycredit', method: 'BILL_PAYMENT' } }),
      ec,
    });
    (initEasyCreditClient as jest.Mock).mockReturnValue({
      getWebshopInfo: jest.fn(async () => {
        throw new Error('easyCredit is down');
      }),
      getPayment: getECPayment,
      updatePayment: updateECPayment,
    });

    expect(await getErrorCodes(handleExpressReturn('session-cart', 'payment123'))).toEqual(['EasyCreditUnavailable']);
    expect(updateECPayment).not.toHaveBeenCalled();
    expect(authorization('Initial')).toHaveLength(1);
    expect(state.cart.cartState).toBe('Frozen');
  });

  it('should write neither birth date nor IBAN to commercetools or the logs', async () => {
    const spies = (['info', 'warn', 'error'] as const).map((level) => jest.spyOn(log, level));
    setup({ cart: buildCart(50000), payment: buildPayment(50000), ec: buildECPayment(500) });
    updateECPayment.mockImplementation(async () => summary(504.95, 'NEGATIVE'));

    await handleExpressReturn('session-cart', 'payment123').catch(() => undefined);

    const written = JSON.stringify([
      jest.mocked(updateCart).mock.calls,
      jest.mocked(updatePayment).mock.calls,
      ...spies.map((spy) => spy.mock.calls),
    ]);
    expect(written).not.toContain(BIRTH_DATE);
    expect(written).not.toContain(IBAN);
    spies.forEach((spy) => spy.mockRestore());
  });

  it('should answer the route with the summary and without customer data', async () => {
    setup({ cart: buildCart(50000), payment: buildPayment(50000), ec: buildECPayment(500) });
    const app = fastify();
    app.setErrorHandler(errorHandler);
    const authHook = { authenticate: () => async () => {} };
    await app.register(paymentsRoute, {
      prefix: '/payments',
      sessionHeaderAuthHook: authHook,
      oauth2AuthHook: authHook,
      authorizationHook: { authorize: () => async () => {} },
    } as unknown as Parameters<typeof paymentsRoute>[1]);

    const response = await app.inject({ method: 'POST', url: '/payments/express/payment123/return' });

    expect(response.statusCode).toBe(200);
    // Storefront clients often send a JSON content type without a body.
    const withContentType = await app.inject({
      method: 'POST',
      url: '/payments/express/payment123/return',
      headers: { 'content-type': 'application/json' },
    });
    expect(withContentType.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ amount: 504.95, decision: { orderValue: 504.95, interest: 13.1 } });
    expect(response.body).not.toContain('Ratenkauf');
    expect(response.body).not.toContain(IBAN);
  });
});

describe('handleAuthorizeECPayment for express', () => {
  // The state right after a successful return: easyCredit address on the cart, amounts in sync.
  const returned = (overrides: Record<string, unknown> = {}) =>
    setup({
      cart: buildCart(50000, {
        billingAddress: ctAddress,
        shippingAddress: ctAddress,
        shippingInfo: { shippingMethod: { typeId: 'shipping-method', id: 'standard' } },
        totalPrice: { type: 'centPrecision', currencyCode: 'EUR', centAmount: 50495, fractionDigits: 2 },
        ...overrides,
      }),
      payment: buildPayment(50495),
      ec: buildECPayment(504.95),
    });

  it('should authorize when the cart still carries the easyCredit address and amount', async () => {
    returned();

    await handleAuthorizeECPayment('payment123');

    expect(updateECPayment).not.toHaveBeenCalled();
    expect(authorizeECPayment).toHaveBeenCalledWith('tech123', 'payment123', expect.anything());
    expect(authorization('Pending')).toMatchObject([{ id: 'tx-1' }]);
  });

  it('should refuse the authorization when the address on the cart was changed', async () => {
    returned({
      billingAddress: { ...ctAddress, streetNumber: '27' },
      shippingAddress: { ...ctAddress, streetNumber: '27' },
    });

    expect(await getErrorCodes(handleAuthorizeECPayment('payment123'))).toEqual(['ExpressAddressMismatch']);
    expect(authorizeECPayment).not.toHaveBeenCalled();
    expectAbandoned();
  });

  it('should refuse the authorization when easyCredit has no address for the transaction', async () => {
    returned();
    ecPayment.transaction.orderDetails.shippingAddress = null;

    expect(await getErrorCodes(handleAuthorizeECPayment('payment123'))).toEqual(['InvalidShippingAddress']);
    expect(authorizeECPayment).not.toHaveBeenCalled();
    expectAbandoned();
  });

  it('should refuse the authorization when the return was skipped, keeping the attempt open', async () => {
    setup({ cart: buildCart(50000), payment: buildPayment(50000), ec: buildECPayment(500) });

    expect(await getErrorCodes(handleAuthorizeECPayment('payment123'))).toEqual(['ExpressAddressMissing']);
    expect(authorizeECPayment).not.toHaveBeenCalled();
    expect(authorization('Initial')).toHaveLength(1);
    expect(state.cart.cartState).toBe('Frozen');
  });

  it('should patch a total changed after the return, then authorize the new transaction', async () => {
    returned({ totalPrice: { type: 'centPrecision', currencyCode: 'EUR', centAmount: 51290, fractionDigits: 2 } });

    await handleAuthorizeECPayment('payment123');

    expect(updateECPayment).toHaveBeenCalledWith(
      'tech123',
      expect.objectContaining({ orderValue: 512.9 }),
      expect.anything(),
    );
    expect(authorizeECPayment).toHaveBeenCalled();
    expect(authorization('Pending')).toMatchObject([{ amount: { centAmount: 51290 } }]);
    expect(authorization('Failure')).toMatchObject([{ id: 'tx-1' }]);
  });

  it('should refuse the authorization when the PATCH of a changed total is negative', async () => {
    returned({ totalPrice: { type: 'centPrecision', currencyCode: 'EUR', centAmount: 51290, fractionDigits: 2 } });
    updateECPayment.mockImplementation(async () => summary(512.9, 'NEGATIVE'));

    expect(await getErrorCodes(handleAuthorizeECPayment('payment123'))).toEqual(['DecisionNotPositive']);
    expect(authorizeECPayment).not.toHaveBeenCalled();
    expectAbandoned();
  });

  it('should abandon an attempt that expired at easyCredit', async () => {
    returned();
    getECPayment.mockImplementation(async () => {
      throw expiredError();
    });

    expect(await getErrorCodes(handleAuthorizeECPayment('payment123'))).toEqual(['TransactionExpired']);
    expect(authorizeECPayment).not.toHaveBeenCalled();
    expectAbandoned();
  });

  it('should only replace the transaction when easyCredit already has the new total', async () => {
    returned();
    state.payment = buildPayment(50000);

    await handleAuthorizeECPayment('payment123');

    expect(updateECPayment).not.toHaveBeenCalled();
    expect(authorizeECPayment).toHaveBeenCalled();
    expect(authorization('Pending')).toMatchObject([{ amount: { centAmount: 50495 } }]);
  });

  describe('with excluded cart items', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      process.env.INSTALLMENT_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS = 'voucher-item';
    });

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('should refuse the authorization even when the totals are in sync', async () => {
      // The shop unfroze the cart, swapped an item for an excluded one at the same total and froze it again.
      returned({ customLineItems: [{ slug: 'voucher-item' }] });

      expect(await getErrorCodes(handleAuthorizeECPayment('payment123'))).toEqual(['InstallmentPaymentExcludedItems']);
      expect(updateECPayment).not.toHaveBeenCalled();
      expect(authorizeECPayment).not.toHaveBeenCalled();
      expectAbandoned();
    });
  });

  it('should not replace a transaction that a concurrent cancel failed', async () => {
    returned({ totalPrice: { type: 'centPrecision', currencyCode: 'EUR', centAmount: 51290, fractionDigits: 2 } });
    cancelDuringValidation();

    expect(await getErrorCodes(handleAuthorizeECPayment('payment123'))).toEqual(['TransactionNotPreauthorized']);
    expect(updateECPayment).not.toHaveBeenCalled();
    expect(authorizeECPayment).not.toHaveBeenCalled();
    expect(authorization('Failure')).toMatchObject([{ id: 'tx-1' }]);
    expectAbandoned();
  });

  it('should leave an unfrozen cart to the amount check without a PATCH', async () => {
    returned({
      cartState: 'Active',
      totalPrice: { type: 'centPrecision', currencyCode: 'EUR', centAmount: 51290, fractionDigits: 2 },
    });

    expect(await getErrorCodes(handleAuthorizeECPayment('payment123'))).toEqual(['AmountMismatch']);
    expect(updateECPayment).not.toHaveBeenCalled();
  });
});
