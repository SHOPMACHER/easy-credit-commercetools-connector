import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { handleCreatePayment, handleGetPayment } from '../../src/services/payment.service';
import { getCartById, getCartByPaymentId, updateCart } from '../../src/commercetools/cart.commercetools';
import { createPayment, getPaymentById, updatePayment } from '../../src/commercetools/payment.commercetools';
import { initEasyCreditClient } from '../../src/client/easycredit.client';
import { Errorx } from '@commercetools/connect-payments-sdk';
import * as validators from '../../src/validators/payment.validators';
import { log } from '../../src/libs/logger';
import { readConfiguration } from '../../src/utils/config.utils';
import { getPaymentTypesAvailability } from '../../src/services/webshop.service';
import { getBillPaymentExclusion } from '../../src/services/billPaymentRestriction.service';
import { getShippingAddress, getShippingDestinations } from '../../src/utils/map.utils';

jest.mock('../../src/commercetools/cart.commercetools');
jest.mock('../../src/commercetools/payment.commercetools');
jest.mock('../../src/client/easycredit.client');
jest.mock('../../src/libs/logger');
jest.mock('../../src/utils/map.utils');
jest.mock('../../src/services/webshop.service');
jest.mock('../../src/services/billPaymentRestriction.service');
jest.mock('../../src/utils/config.utils', () => {
  const config = {
    easyCredit: { webShopId: 'webShopId123', billPaymentEnabled: '1' },
    commerceTools: { projectKey: 'projectKey123', clientId: 'clientId123', clientSecret: 'clientSecret', region: 'eu' },
  };
  return { readConfiguration: jest.fn(() => config) };
});

type AnyFn = (...args: any[]) => any;
const mock = (fn: unknown) => fn as jest.Mock<AnyFn>;
const setBillPaymentEnabled = (value: '0' | '1') => {
  mock(readConfiguration)().easyCredit.billPaymentEnabled = value;
};

const PAYMENT_ID = 'payment-1';
const INSTALLMENT = 'INSTALLMENT_PAYMENT';
const BILL = 'BILL_PAYMENT';
// Installment payments keep the method of earlier releases.
const INSTALLMENT_METHOD = 'easycredit';

const buildPayment = (method: string, txState = 'Initial', storedFields: Record<string, number> = {}) => ({
  id: PAYMENT_ID,
  version: 3,
  paymentMethodInfo: { paymentInterface: 'easycredit', method },
  transactions: [
    {
      id: 'tx-1',
      type: 'Authorization',
      state: txState,
      interactionId: 'ec-1',
      amount: { centAmount: 10000, currencyCode: 'EUR', fractionDigits: 2 },
      custom: { fields: { easyCreditTechnicalTransactionId: 'tech-1', ...storedFields } },
    },
  ],
});

const ecPayment = (status: string, paymentType?: string, decisionValues: Record<string, number> = {}) => ({
  status,
  decision: { transactionId: 'tech-1', orderValue: 100, decisionOutcome: 'POSITIVE', ...decisionValues },
  ...(paymentType ? { transaction: { paymentType } } : {}),
});

const billActions = [
  { action: 'setMethodInfoMethod', method: BILL },
  { action: 'setMethodInfoName', name: { de: 'easyCredit Rechnung' } },
];
const installmentActions = [
  { action: 'setMethodInfoMethod', method: INSTALLMENT_METHOD },
  { action: 'setMethodInfoName', name: { de: 'easyCredit Ratenkauf' } },
];

const client = { getPayment: jest.fn<AnyFn>(), createPayment: jest.fn<AnyFn>() };

const address = {
  firstName: 'Erika',
  lastName: 'Mustermann',
  streetName: 'Hauptstrasse',
  streetNumber: '1',
  city: 'Gescher',
  postalCode: '48712',
  country: 'DE',
};

const buildCart = (overrides: Record<string, unknown> = {}) => ({
  id: 'cart-1',
  cartState: 'Frozen',
  totalPrice: { centAmount: 10000, currencyCode: 'EUR', fractionDigits: 2 },
  billingAddress: { ...address },
  shippingAddress: { ...address },
  ...overrides,
});

const switchToBill = () => {
  mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT));
  client.getPayment.mockResolvedValue(ecPayment('PREAUTHORIZED', BILL));
};

// Messages the payment type sync logs about the type easyCredit sent.
const easyCreditTypeLogs = () =>
  mock(log.error)
    .mock.calls.map((c) => c[0])
    .filter((message) => typeof message === 'string' && message.startsWith('easyCredit sent'));

const changeTransactionStateFailure = [{ action: 'changeTransactionState', transactionId: 'tx-1', state: 'Failure' }];

describe('handleGetPayment payment type sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    client.getPayment.mockReset();
    mock(initEasyCreditClient).mockReturnValue(client);
    mock(updatePayment).mockResolvedValue({});
    setBillPaymentEnabled('1');
    mock(getCartByPaymentId).mockResolvedValue(buildCart());
    mock(getShippingAddress).mockImplementation((cart: any) => cart.shippingAddress);
    mock(getShippingDestinations).mockImplementation((cart: any) => [cart.shippingAddress]);
    mock(getBillPaymentExclusion).mockResolvedValue({ productTypeKeys: [], customLineItems: [] });
    mock(getPaymentTypesAvailability).mockImplementation(async (amount: number) => ({
      INSTALLMENT_PAYMENT: {
        enabled: true,
        available: amount >= 200 && amount <= 5000,
        minAmount: 200,
        maxAmount: 5000,
      },
      BILL_PAYMENT: { enabled: true, available: amount >= 50 && amount <= 5000, minAmount: 50, maxAmount: 5000 },
    }));
  });

  it('records BILL_PAYMENT when easyCredit (AUTHORIZED) says bill and CT stores installment', async () => {
    mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT));
    client.getPayment.mockResolvedValue(ecPayment('AUTHORIZED', BILL));

    const result = await handleGetPayment(PAYMENT_ID);

    expect(updatePayment).toHaveBeenCalledTimes(1);
    expect(updatePayment).toHaveBeenCalledWith(expect.anything(), billActions);
    expect(result.paymentType).toBe(BILL);
  });

  it('records the easycredit method when easyCredit says installment and CT stores bill', async () => {
    mock(getPaymentById).mockResolvedValue(buildPayment(BILL));
    client.getPayment.mockResolvedValue(ecPayment('AUTHORIZED', INSTALLMENT));

    const result = await handleGetPayment(PAYMENT_ID);

    expect(updatePayment).toHaveBeenCalledWith(expect.anything(), installmentActions);
    expect(result.paymentType).toBe(INSTALLMENT);
  });

  it('keeps an installment payment and warns when easyCredit sends no paymentType', async () => {
    mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT));
    client.getPayment.mockResolvedValue(ecPayment('AUTHORIZED'));

    const result = await handleGetPayment(PAYMENT_ID);

    expect(updatePayment).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalled();
    expect(result.paymentType).toBe(INSTALLMENT);
  });

  it('throws PaymentTypeUnknown when an unauthorized bill payment gets no paymentType from easyCredit', async () => {
    mock(getPaymentById).mockResolvedValue(buildPayment(BILL));
    client.getPayment.mockResolvedValue(ecPayment('PREAUTHORIZED'));

    await expect(handleGetPayment(PAYMENT_ID)).rejects.toMatchObject({
      code: 'PaymentTypeUnknown',
      httpErrorStatus: 502,
      message:
        'easyCredit hat keine gültige Zahlungsart zur Transaktion geliefert. Die Zahlung kann nicht fortgesetzt werden.',
    });

    expect(easyCreditTypeLogs()).toEqual(['easyCredit sent no payment type for a bill payment']);
    expect(updatePayment).not.toHaveBeenCalled();
  });

  it.each([
    ['AUTHORIZED with an Initial transaction', 'AUTHORIZED', 'Initial'],
    ['PREAUTHORIZED with a Pending transaction', 'PREAUTHORIZED', 'Pending'],
    ['PREAUTHORIZED with a Success transaction', 'PREAUTHORIZED', 'Success'],
  ])(
    'keeps a stored bill payment and logs an error when easyCredit sends no paymentType (%s)',
    async (_n, status, txState) => {
      mock(getPaymentById).mockResolvedValue(buildPayment(BILL, txState));
      client.getPayment.mockResolvedValue(ecPayment(status));

      const result = await handleGetPayment(PAYMENT_ID);

      expect(result.paymentType).toBe(BILL);
      expect(easyCreditTypeLogs()).toEqual(['easyCredit sent no payment type for a bill payment']);
      expect(updatePayment).not.toHaveBeenCalled();
    },
  );

  it('does not rewrite the easycredit method when easyCredit says installment', async () => {
    mock(getPaymentById).mockResolvedValue(buildPayment('easycredit'));
    client.getPayment.mockResolvedValue(ecPayment('AUTHORIZED', INSTALLMENT));

    const result = await handleGetPayment(PAYMENT_ID);

    expect(updatePayment).not.toHaveBeenCalled();
    expect(result.paymentType).toBe(INSTALLMENT);
  });

  it('does not write when the stored type already matches', async () => {
    mock(getPaymentById).mockResolvedValue(buildPayment(BILL));
    client.getPayment.mockResolvedValue(ecPayment('PREAUTHORIZED', BILL));

    await handleGetPayment(PAYMENT_ID);

    expect(updatePayment).not.toHaveBeenCalled();
  });

  // Real easyCredit answer for a completed bill payment: interest is a JSON null and totalValue equals orderValue.
  it('omits null decision fields from the response instead of serializing them as 0', async () => {
    mock(getPaymentById).mockResolvedValue(buildPayment(BILL));
    client.getPayment.mockResolvedValue({
      ...ecPayment('PREAUTHORIZED', BILL, { totalValue: 100 }),
      decision: { ...ecPayment('PREAUTHORIZED', BILL).decision, totalValue: 100, interest: null, mtan: null },
    });

    const { decision } = await handleGetPayment(PAYMENT_ID);

    expect('interest' in decision).toBe(false);
    expect('mtan' in decision).toBe(false);
    expect(decision.totalValue).toBe(100);
    expect(decision.orderValue).toBe(100);
  });

  it('treats a null interest like an absent one when recording interest for an installment payment', async () => {
    mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT));
    client.getPayment.mockResolvedValue({
      ...ecPayment('PREAUTHORIZED', INSTALLMENT),
      decision: { ...ecPayment('PREAUTHORIZED', INSTALLMENT).decision, interest: null, totalValue: 100 },
    });

    await handleGetPayment(PAYMENT_ID);

    expect(updatePayment).toHaveBeenCalledTimes(1);
    expect(mock(updatePayment).mock.calls[0][1]).toStrictEqual([
      { action: 'setTransactionCustomField', transactionId: 'tx-1', name: 'easyCreditTotalValue', value: 100 },
    ]);
  });

  it('retries once on a 409 with a fresh payment and then succeeds', async () => {
    const fresh = buildPayment(INSTALLMENT);
    mock(getPaymentById).mockResolvedValueOnce(buildPayment(INSTALLMENT)).mockResolvedValueOnce(fresh);
    client.getPayment.mockResolvedValue(ecPayment('PREAUTHORIZED', BILL));
    mock(updatePayment).mockRejectedValueOnce({ httpErrorStatus: 409 }).mockResolvedValueOnce({});

    const result = await handleGetPayment(PAYMENT_ID);

    expect(updatePayment).toHaveBeenCalledTimes(2);
    expect(updatePayment).toHaveBeenLastCalledWith(fresh, billActions);
    expect(result.paymentType).toBe(BILL);
  });

  it('rethrows a second 409 for PREAUTHORIZED', async () => {
    mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT));
    client.getPayment.mockResolvedValue(ecPayment('PREAUTHORIZED', BILL));
    mock(updatePayment).mockRejectedValue({ httpErrorStatus: 409 });

    await expect(handleGetPayment(PAYMENT_ID)).rejects.toMatchObject({ httpErrorStatus: 409 });

    expect(updatePayment).toHaveBeenCalledTimes(2);
  });

  it('is a no-op for a Failure transaction and keeps the stored type', async () => {
    mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT, 'Failure'));
    client.getPayment.mockResolvedValue(ecPayment('PREAUTHORIZED', BILL));

    const result = await handleGetPayment(PAYMENT_ID);

    expect(getCartByPaymentId).not.toHaveBeenCalled();
    expect(updateCart).not.toHaveBeenCalled();
    expect(updatePayment).not.toHaveBeenCalled();
    expect(result.paymentType).toBe(INSTALLMENT);
  });

  it.each(['OPEN', 'DECLINED', 'EXPIRED'])('is a no-op for status %s', async (status) => {
    mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT));
    client.getPayment.mockResolvedValue(ecPayment(status, BILL));

    const result = await handleGetPayment(PAYMENT_ID);

    expect(updatePayment).not.toHaveBeenCalled();
    expect(result.paymentType).toBe(INSTALLMENT);
  });

  it('logs and swallows a failing record-only write (AUTHORIZED)', async () => {
    mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT));
    client.getPayment.mockResolvedValue(ecPayment('AUTHORIZED', BILL));
    mock(updatePayment).mockRejectedValue(new Error('boom'));

    const result = await handleGetPayment(PAYMENT_ID);

    expect(log.warn).toHaveBeenCalled();
    expect(result.paymentType).toBe(BILL);
  });

  describe('an unrecognised paymentType from easyCredit is treated like an absent one', () => {
    it('PREAUTHORIZED with a stored installment: no switch, no validation, no write, error logged', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT));
      client.getPayment.mockResolvedValue(ecPayment('PREAUTHORIZED', 'DIRECT_PAYMENT'));

      const result = await handleGetPayment(PAYMENT_ID);

      expect(result.paymentType).toBe(INSTALLMENT);
      expect(getCartByPaymentId).not.toHaveBeenCalled();
      expect(updatePayment).not.toHaveBeenCalled();
      expect(log.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ paymentId: PAYMENT_ID, paymentType: 'DIRECT_PAYMENT' }),
      );
    });

    it('AUTHORIZED with a wrongly cased value and a stored installment: no method write', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT));
      client.getPayment.mockResolvedValue(ecPayment('AUTHORIZED', 'bill_payment'));

      const result = await handleGetPayment(PAYMENT_ID);

      expect(result.paymentType).toBe(INSTALLMENT);
      expect(updatePayment).not.toHaveBeenCalled();
      expect(log.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ paymentType: 'bill_payment' }),
      );
    });

    it('records the interest of a stored installment like for an absent type', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT));
      client.getPayment.mockResolvedValue(
        ecPayment('PREAUTHORIZED', 'DIRECT_PAYMENT', { interest: 12.34, totalValue: 112.34 }),
      );

      await handleGetPayment(PAYMENT_ID);

      expect(updatePayment).toHaveBeenCalledTimes(1);
      expect(mock(updatePayment).mock.calls[0][1][0].action).toBe('setTransactionCustomField');
    });

    it('a stored bill payment with an Initial transaction (PREAUTHORIZED) throws PaymentTypeUnknown and writes nothing', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(BILL));
      client.getPayment.mockResolvedValue(ecPayment('PREAUTHORIZED', 'DIRECT_PAYMENT'));

      await expect(handleGetPayment(PAYMENT_ID)).rejects.toMatchObject({
        code: 'PaymentTypeUnknown',
        httpErrorStatus: 502,
      });

      expect(updatePayment).not.toHaveBeenCalled();
      expect(easyCreditTypeLogs()).toEqual(['easyCredit sent an unknown payment type']);
    });

    it.each([
      ['AUTHORIZED', 'AUTHORIZED', 'Initial'],
      ['PREAUTHORIZED with a Pending transaction', 'PREAUTHORIZED', 'Pending'],
    ])('a stored bill payment keeps its type without throwing (%s)', async (_n, status, txState) => {
      mock(getPaymentById).mockResolvedValue(buildPayment(BILL, txState));
      client.getPayment.mockResolvedValue(ecPayment(status, 'DIRECT_PAYMENT'));

      const result = await handleGetPayment(PAYMENT_ID);

      expect(result.paymentType).toBe(BILL);
      expect(updatePayment).not.toHaveBeenCalled();
      expect(easyCreditTypeLogs()).toEqual(['easyCredit sent an unknown payment type']);
    });
  });

  describe('validating the final type of a PREAUTHORIZED payment', () => {
    const expectTransactionFailed = () => {
      expect(updatePayment).toHaveBeenCalledTimes(1);
      expect(updatePayment).toHaveBeenCalledWith(expect.anything(), changeTransactionStateFailure);
      expect(updateCart).toHaveBeenCalledWith(expect.anything(), [{ action: 'unfreezeCart' }]);
    };

    const expectTransactionUntouched = () => {
      expect(updatePayment).not.toHaveBeenCalled();
      expect(updateCart).not.toHaveBeenCalled();
    };

    it('valid cart: writes the method, leaves the transaction Initial', async () => {
      switchToBill();

      const result = await handleGetPayment(PAYMENT_ID);

      expect(getCartByPaymentId).toHaveBeenCalledWith(PAYMENT_ID);
      expect(updatePayment).toHaveBeenCalledTimes(1);
      expect(updatePayment).toHaveBeenCalledWith(expect.anything(), billActions);
      expect(updateCart).not.toHaveBeenCalled();
      expect(result.paymentType).toBe(BILL);
    });

    it('a validation failure leaves a transaction that moved to Pending (request in flight) untouched', async () => {
      switchToBill();
      mock(getPaymentById).mockReset().mockResolvedValueOnce(buildPayment(INSTALLMENT));
      mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT, 'Pending'));
      mock(getCartByPaymentId).mockResolvedValue(buildCart({ billingAddress: { ...address, company: 'ACME GmbH' } }));

      await expect(handleGetPayment(PAYMENT_ID)).rejects.toMatchObject({
        errors: [expect.objectContaining({ code: 'CorporateCustomerNotAllowed' })],
      });

      expectTransactionUntouched();
    });

    it('a validation failure leaves a transaction that is already Failure alone, so the cart of a newer attempt stays frozen', async () => {
      switchToBill();
      mock(getPaymentById).mockReset().mockResolvedValueOnce(buildPayment(INSTALLMENT));
      mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT, 'Failure'));
      mock(getCartByPaymentId).mockResolvedValue(buildCart({ billingAddress: { ...address, company: 'ACME GmbH' } }));

      await expect(handleGetPayment(PAYMENT_ID)).rejects.toMatchObject({
        errors: [expect.objectContaining({ code: 'CorporateCustomerNotAllowed' })],
      });

      expectTransactionUntouched();
    });

    it('BILL_PAYMENT_ENABLED=0 on a transaction that is already Failure: rethrown, cart stays frozen', async () => {
      switchToBill();
      mock(getPaymentById).mockReset().mockResolvedValueOnce(buildPayment(INSTALLMENT));
      mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT, 'Failure'));
      setBillPaymentEnabled('0');

      await expect(handleGetPayment(PAYMENT_ID)).rejects.toMatchObject({
        errors: [expect.objectContaining({ code: 'PaymentTypeNotAvailable' })],
      });

      expectTransactionUntouched();
    });

    it('BILL_PAYMENT_ENABLED=0 on a transaction that moved to Pending: rethrown, transaction untouched', async () => {
      switchToBill();
      mock(getPaymentById).mockReset().mockResolvedValueOnce(buildPayment(INSTALLMENT));
      mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT, 'Pending'));
      setBillPaymentEnabled('0');

      await expect(handleGetPayment(PAYMENT_ID)).rejects.toMatchObject({
        errors: [expect.objectContaining({ code: 'PaymentTypeNotAvailable' })],
      });

      expectTransactionUntouched();
    });

    it('BILL_PAYMENT_ENABLED=0: fails the transaction and does not write', async () => {
      switchToBill();
      setBillPaymentEnabled('0');

      await expect(handleGetPayment(PAYMENT_ID)).rejects.toMatchObject({
        errors: [expect.objectContaining({ code: 'PaymentTypeNotAvailable' })],
      });

      expectTransactionFailed();
    });

    it('corporate customer: fails the transaction and does not write', async () => {
      switchToBill();
      mock(getCartByPaymentId).mockResolvedValue(
        buildCart({ billingAddress: { ...address, company: 'ACME GmbH' }, shippingAddress: { ...address } }),
      );

      await expect(handleGetPayment(PAYMENT_ID)).rejects.toMatchObject({
        errors: [expect.objectContaining({ code: 'CorporateCustomerNotAllowed' })],
      });

      expectTransactionFailed();
    });

    it('unmatched addresses: fails the transaction and does not write', async () => {
      switchToBill();
      mock(getCartByPaymentId).mockResolvedValue(buildCart({ shippingAddress: { ...address, streetName: 'Anders' } }));

      await expect(handleGetPayment(PAYMENT_ID)).rejects.toMatchObject({
        errors: [expect.objectContaining({ code: 'AddressesUnmatched' })],
      });

      expectTransactionFailed();
    });

    it('excluded items: fails the transaction and does not write', async () => {
      switchToBill();
      mock(getBillPaymentExclusion).mockResolvedValue({ productTypeKeys: ['voucher'], customLineItems: [] });

      await expect(handleGetPayment(PAYMENT_ID)).rejects.toMatchObject({
        errors: [expect.objectContaining({ code: 'BillPaymentExcludedItems' })],
      });

      expectTransactionFailed();
    });

    it('total outside 50 to 5000: fails the transaction with InvalidAmount', async () => {
      switchToBill();
      mock(getCartByPaymentId).mockResolvedValue(
        buildCart({ totalPrice: { centAmount: 4000, currencyCode: 'EUR', fractionDigits: 2 } }),
      );

      await expect(handleGetPayment(PAYMENT_ID)).rejects.toMatchObject({
        errors: [expect.objectContaining({ code: 'InvalidAmount' })],
      });

      expectTransactionFailed();
    });

    it('switch to installment with total below 200: fails the transaction with InvalidAmount', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(BILL));
      client.getPayment.mockResolvedValue(ecPayment('PREAUTHORIZED', INSTALLMENT));

      await expect(handleGetPayment(PAYMENT_ID)).rejects.toMatchObject({
        errors: [expect.objectContaining({ code: 'InvalidAmount' })],
      });

      expectTransactionFailed();
    });

    it('currency other than EUR: fails the transaction with InvalidCurrency', async () => {
      switchToBill();
      mock(getCartByPaymentId).mockResolvedValue(
        buildCart({ totalPrice: { centAmount: 10000, currencyCode: 'USD', fractionDigits: 2 } }),
      );

      await expect(handleGetPayment(PAYMENT_ID)).rejects.toMatchObject({
        errors: [expect.objectContaining({ code: 'InvalidCurrency' })],
      });

      expectTransactionFailed();
    });

    it('incomplete address: fails the transaction with InvalidAddress', async () => {
      switchToBill();
      mock(getCartByPaymentId).mockResolvedValue(
        buildCart({
          billingAddress: { ...address, postalCode: '1' },
          shippingAddress: { ...address, postalCode: '1' },
        }),
      );

      await expect(handleGetPayment(PAYMENT_ID)).rejects.toMatchObject({
        errors: [expect.objectContaining({ code: 'InvalidAddress' })],
      });

      expectTransactionFailed();
    });

    it('missing billing address (InvalidBillingAddress + AddressesUnmatched): fails the transaction', async () => {
      switchToBill();
      mock(getCartByPaymentId).mockResolvedValue(buildCart({ billingAddress: undefined }));

      await expect(handleGetPayment(PAYMENT_ID)).rejects.toMatchObject({
        errors: [
          expect.objectContaining({ code: 'InvalidBillingAddress' }),
          expect.objectContaining({ code: 'AddressesUnmatched' }),
        ],
      });

      expectTransactionFailed();
    });

    it('missing shipping address (InvalidShippingAddress + AddressesUnmatched): fails the transaction', async () => {
      switchToBill();
      mock(getCartByPaymentId).mockResolvedValue(buildCart({ shippingAddress: undefined }));
      mock(getShippingDestinations).mockReturnValue([]);

      await expect(handleGetPayment(PAYMENT_ID)).rejects.toMatchObject({
        errors: [
          expect.objectContaining({ code: 'InvalidShippingAddress' }),
          expect.objectContaining({ code: 'AddressesUnmatched' }),
        ],
      });

      expectTransactionFailed();
    });

    it('a mixed error list with a non-whitelisted code is rethrown, transaction untouched', async () => {
      switchToBill();
      mock(getCartByPaymentId).mockResolvedValue(buildCart({ shippingAddress: { ...address, streetName: 'Anders' } }));
      const spy = jest.spyOn(validators, 'validateCurrency').mockImplementation((_currency, _config, errors) => {
        errors.push(new Errorx({ code: 'SomethingElse', message: 'unexpected', httpErrorStatus: 500 }));
      });

      try {
        await expect(handleGetPayment(PAYMENT_ID)).rejects.toMatchObject({
          errors: [
            expect.objectContaining({ code: 'AddressesUnmatched' }),
            expect.objectContaining({ code: 'SomethingElse' }),
          ],
        });
      } finally {
        spy.mockRestore();
      }

      expectTransactionUntouched();
    });

    it('rethrows the validation error when failing the transaction itself fails', async () => {
      switchToBill();
      mock(getCartByPaymentId).mockResolvedValue(buildCart({ shippingAddress: { ...address, streetName: 'Anders' } }));
      mock(updatePayment).mockRejectedValue(new Error('commercetools down'));

      await expect(handleGetPayment(PAYMENT_ID)).rejects.toMatchObject({
        errors: [expect.objectContaining({ code: 'AddressesUnmatched' })],
      });

      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining('after a failed payment type validation'),
        expect.any(Error),
      );
    });

    it('stale webshop data (PaymentTypeNotAvailable from validateCart): rethrown, transaction untouched', async () => {
      switchToBill();
      mock(getPaymentTypesAvailability).mockResolvedValue({
        INSTALLMENT_PAYMENT: { enabled: true, available: true, minAmount: 200, maxAmount: 5000 },
        BILL_PAYMENT: { enabled: false, available: false },
      });

      await expect(handleGetPayment(PAYMENT_ID)).rejects.toMatchObject({
        errors: [expect.objectContaining({ code: 'PaymentTypeNotAvailable' })],
      });

      expectTransactionUntouched();
    });

    it('503 BillPaymentCheckFailed: rethrown, transaction untouched', async () => {
      switchToBill();
      mock(getBillPaymentExclusion).mockRejectedValue(new Error('product type lookup down'));

      await expect(handleGetPayment(PAYMENT_ID)).rejects.toMatchObject({
        errors: [expect.objectContaining({ code: 'BillPaymentCheckFailed', httpErrorStatus: 503 })],
      });

      expectTransactionUntouched();
    });

    it('an unreadable cart is rethrown without touching the transaction', async () => {
      switchToBill();
      mock(getCartByPaymentId).mockRejectedValue({ httpErrorStatus: 500 });

      await expect(handleGetPayment(PAYMENT_ID)).rejects.toMatchObject({ httpErrorStatus: 500 });

      expectTransactionUntouched();
    });

    it('no validation when the type did not change', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(BILL));
      client.getPayment.mockResolvedValue(ecPayment('PREAUTHORIZED', BILL));

      await handleGetPayment(PAYMENT_ID);

      expect(getCartByPaymentId).not.toHaveBeenCalled();
    });

    it('no validation for status AUTHORIZED', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT));
      client.getPayment.mockResolvedValue(ecPayment('AUTHORIZED', BILL));
      setBillPaymentEnabled('0');

      const result = await handleGetPayment(PAYMENT_ID);

      expect(getCartByPaymentId).not.toHaveBeenCalled();
      expect(updatePayment).toHaveBeenCalledWith(expect.anything(), billActions);
      expect(result.paymentType).toBe(BILL);
    });

    it('no validation for a Pending transaction (record-only)', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT, 'Pending'));
      client.getPayment.mockResolvedValue(ecPayment('PREAUTHORIZED', BILL));
      setBillPaymentEnabled('0');

      const result = await handleGetPayment(PAYMENT_ID);

      expect(getCartByPaymentId).not.toHaveBeenCalled();
      expect(updatePayment).toHaveBeenCalledWith(expect.anything(), billActions);
      expect(result.paymentType).toBe(BILL);
    });
  });

  describe('recording interest and total value', () => {
    const decisionValues = { interest: 12.34, totalValue: 112.34 };
    const setBoth = [
      { action: 'setTransactionCustomField', transactionId: 'tx-1', name: 'easyCreditInterest', value: 12.34 },
      { action: 'setTransactionCustomField', transactionId: 'tx-1', name: 'easyCreditTotalValue', value: 112.34 },
    ];
    const clearBoth = [
      { action: 'setTransactionCustomField', transactionId: 'tx-1', name: 'easyCreditInterest' },
      { action: 'setTransactionCustomField', transactionId: 'tx-1', name: 'easyCreditTotalValue' },
    ];
    const expectNoValueKey = (actions: any[]) => actions.forEach((action) => expect('value' in action).toBe(false));
    const stored = { easyCreditInterest: 12.34, easyCreditTotalValue: 112.34 };
    const installmentCart = () =>
      mock(getCartByPaymentId).mockResolvedValue(
        buildCart({ totalPrice: { centAmount: 30000, currencyCode: 'EUR', fractionDigits: 2 } }),
      );

    it('installment with interest records both fields', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT));
      client.getPayment.mockResolvedValue(ecPayment('PREAUTHORIZED', INSTALLMENT, decisionValues));

      const result = await handleGetPayment(PAYMENT_ID);

      expect(updatePayment).toHaveBeenCalledTimes(1);
      expect(updatePayment).toHaveBeenCalledWith(expect.anything(), setBoth);
      expect(result.paymentType).toBe(INSTALLMENT);
    });

    it('records the values after a switch to installment, on the payment returned by the method write', async () => {
      installmentCart();
      mock(getPaymentById).mockResolvedValue(buildPayment(BILL));
      client.getPayment.mockResolvedValue(ecPayment('PREAUTHORIZED', INSTALLMENT, decisionValues));
      const written = { id: PAYMENT_ID, version: 4 };
      mock(updatePayment).mockResolvedValueOnce(written).mockResolvedValueOnce({});

      await handleGetPayment(PAYMENT_ID);

      expect(updatePayment).toHaveBeenCalledTimes(2);
      expect(updatePayment).toHaveBeenNthCalledWith(1, expect.anything(), installmentActions);
      expect(updatePayment).toHaveBeenNthCalledWith(2, written, setBoth);
    });

    it('same values already stored: no interest write', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT, 'Initial', stored));
      client.getPayment.mockResolvedValue(ecPayment('PREAUTHORIZED', INSTALLMENT, decisionValues));

      await handleGetPayment(PAYMENT_ID);

      expect(updatePayment).not.toHaveBeenCalled();
    });

    it('term changed on the easyCredit page, type unchanged: values are updated', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT, 'Initial', stored));
      client.getPayment.mockResolvedValue(
        ecPayment('PREAUTHORIZED', INSTALLMENT, { interest: 20.5, totalValue: 120.5 }),
      );

      await handleGetPayment(PAYMENT_ID);

      expect(updatePayment).toHaveBeenCalledTimes(1);
      expect(updatePayment).toHaveBeenCalledWith(expect.anything(), [
        { action: 'setTransactionCustomField', transactionId: 'tx-1', name: 'easyCreditInterest', value: 20.5 },
        { action: 'setTransactionCustomField', transactionId: 'tx-1', name: 'easyCreditTotalValue', value: 120.5 },
      ]);
    });

    it('writes only the field that differs', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT, 'Initial', stored));
      client.getPayment.mockResolvedValue(
        ecPayment('PREAUTHORIZED', INSTALLMENT, { interest: 12.34, totalValue: 130 }),
      );

      await handleGetPayment(PAYMENT_ID);

      expect(updatePayment).toHaveBeenCalledWith(expect.anything(), [
        { action: 'setTransactionCustomField', transactionId: 'tx-1', name: 'easyCreditTotalValue', value: 130 },
      ]);
    });

    it('installment without values in the response clears stored values', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT, 'Initial', stored));
      client.getPayment.mockResolvedValue(ecPayment('PREAUTHORIZED', INSTALLMENT));

      await handleGetPayment(PAYMENT_ID);

      expect(updatePayment).toHaveBeenCalledTimes(1);
      expect(updatePayment).toHaveBeenCalledWith(expect.anything(), clearBoth);
      expectNoValueKey(mock(updatePayment).mock.calls[0][1]);
    });

    it('switch to bill clears both fields after the method write', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT, 'Initial', stored));
      client.getPayment.mockResolvedValue(ecPayment('PREAUTHORIZED', BILL, decisionValues));

      await handleGetPayment(PAYMENT_ID);

      expect(updatePayment).toHaveBeenCalledTimes(2);
      expect(updatePayment).toHaveBeenNthCalledWith(1, expect.anything(), billActions);
      expect(updatePayment).toHaveBeenNthCalledWith(2, expect.anything(), clearBoth);
      expectNoValueKey(mock(updatePayment).mock.calls[1][1]);
    });

    it('bill without stored values: no interest write', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(BILL));
      client.getPayment.mockResolvedValue(ecPayment('PREAUTHORIZED', BILL, decisionValues));

      await handleGetPayment(PAYMENT_ID);

      expect(updatePayment).not.toHaveBeenCalled();
    });

    it('records the values for an AUTHORIZED payment and a Pending transaction (record-only)', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT, 'Pending'));
      client.getPayment.mockResolvedValue(ecPayment('AUTHORIZED', INSTALLMENT, decisionValues));

      await handleGetPayment(PAYMENT_ID);

      expect(updatePayment).toHaveBeenCalledTimes(1);
      expect(updatePayment).toHaveBeenCalledWith(expect.anything(), setBoth);
    });

    it('interest write fails (InvalidField): warning logged, method write and return value unaffected', async () => {
      installmentCart();
      mock(getPaymentById).mockResolvedValue(buildPayment(BILL));
      client.getPayment.mockResolvedValue(ecPayment('PREAUTHORIZED', INSTALLMENT, decisionValues));
      mock(updatePayment)
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Errorx({ code: 'InvalidField', message: 'unknown field', httpErrorStatus: 400 }));

      const result = await handleGetPayment(PAYMENT_ID);

      expect(updatePayment).toHaveBeenCalledTimes(2);
      expect(updatePayment).toHaveBeenNthCalledWith(1, expect.anything(), installmentActions);
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('interest'), expect.anything());
      expect(result.paymentType).toBe(INSTALLMENT);
    });

    it('interest write fails with an unchanged type: warning logged, no throw', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT));
      client.getPayment.mockResolvedValue(ecPayment('PREAUTHORIZED', INSTALLMENT, decisionValues));
      mock(updatePayment).mockRejectedValue(new Error('boom'));

      const result = await handleGetPayment(PAYMENT_ID);

      expect(log.warn).toHaveBeenCalled();
      expect(result.paymentType).toBe(INSTALLMENT);
    });

    it('a failing record-only method write does not stop the interest write', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(BILL));
      client.getPayment.mockResolvedValue(ecPayment('AUTHORIZED', INSTALLMENT, decisionValues));
      mock(updatePayment).mockRejectedValueOnce(new Error('boom'));

      const result = await handleGetPayment(PAYMENT_ID);

      expect(result.paymentType).toBe(INSTALLMENT);
      expect(updatePayment).toHaveBeenCalledTimes(2);
      expect(updatePayment).toHaveBeenLastCalledWith(expect.anything(), setBoth);
    });

    it('a failed validation of the final type writes no interest values', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT, 'Initial', stored));
      client.getPayment.mockResolvedValue(ecPayment('PREAUTHORIZED', BILL, decisionValues));
      setBillPaymentEnabled('0');

      await expect(handleGetPayment(PAYMENT_ID)).rejects.toMatchObject({
        errors: [expect.objectContaining({ code: 'PaymentTypeNotAvailable' })],
      });

      expect(updatePayment).toHaveBeenCalledTimes(1);
      expect(updatePayment).toHaveBeenCalledWith(expect.anything(), changeTransactionStateFailure);
    });

    it('is skipped for a Failure transaction', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT, 'Failure'));
      client.getPayment.mockResolvedValue(ecPayment('PREAUTHORIZED', INSTALLMENT, decisionValues));

      await handleGetPayment(PAYMENT_ID);

      expect(updatePayment).not.toHaveBeenCalled();
    });

    it.each(['OPEN', 'DECLINED', 'EXPIRED'])('is skipped for status %s', async (status) => {
      mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT));
      client.getPayment.mockResolvedValue(ecPayment(status, INSTALLMENT, decisionValues));

      await handleGetPayment(PAYMENT_ID);

      expect(updatePayment).not.toHaveBeenCalled();
    });

    it('records the values for a stored installment when easyCredit sends no payment type', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT));
      client.getPayment.mockResolvedValue(ecPayment('AUTHORIZED', undefined, decisionValues));

      const result = await handleGetPayment(PAYMENT_ID);

      expect(updatePayment).toHaveBeenCalledTimes(1);
      expect(updatePayment).toHaveBeenCalledWith(expect.anything(), setBoth);
      expect(result.paymentType).toBe(INSTALLMENT);
    });

    it('a stored bill without a payment type from an AUTHORIZED easyCredit keeps the type and clears the interest', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(BILL, 'Initial', stored));
      client.getPayment.mockResolvedValue(ecPayment('AUTHORIZED', undefined, decisionValues));

      const result = await handleGetPayment(PAYMENT_ID);

      expect(result.paymentType).toBe(BILL);
      expect(updatePayment).toHaveBeenCalledTimes(1);
      expect(updatePayment).toHaveBeenCalledWith(expect.anything(), clearBoth);
    });

    it('a stored bill without a payment type from a PREAUTHORIZED easyCredit with an Initial transaction still throws', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(BILL, 'Initial', stored));
      client.getPayment.mockResolvedValue(ecPayment('PREAUTHORIZED', undefined, decisionValues));

      await expect(handleGetPayment(PAYMENT_ID)).rejects.toMatchObject({ code: 'PaymentTypeUnknown' });

      expect(updatePayment).not.toHaveBeenCalled();
    });

    it.each([
      ['PREAUTHORIZED, type unchanged', 'PREAUTHORIZED', INSTALLMENT, INSTALLMENT],
      ['AUTHORIZED, record-only switch', 'AUTHORIZED', INSTALLMENT, BILL],
      ['PREAUTHORIZED, validated switch', 'PREAUTHORIZED', BILL, INSTALLMENT],
    ])('a response without a decision does not throw (%s)', async (_name, status, storedType, finalType) => {
      installmentCart();
      mock(getPaymentById).mockResolvedValue(buildPayment(storedType));
      client.getPayment.mockResolvedValue({ ...ecPayment(status, finalType), decision: undefined });

      const result = await handleGetPayment(PAYMENT_ID);

      expect(result.paymentType).toBe(finalType);
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('interest'), expect.anything());
    });

    it('records 0 as 0 and does not treat it as absent', async () => {
      mock(getPaymentById).mockResolvedValue(buildPayment(INSTALLMENT, 'Initial', stored));
      client.getPayment.mockResolvedValue(ecPayment('PREAUTHORIZED', INSTALLMENT, { interest: 0, totalValue: 0 }));

      await handleGetPayment(PAYMENT_ID);

      expect(updatePayment).toHaveBeenCalledWith(expect.anything(), [
        { action: 'setTransactionCustomField', transactionId: 'tx-1', name: 'easyCreditInterest', value: 0 },
        { action: 'setTransactionCustomField', transactionId: 'tx-1', name: 'easyCreditTotalValue', value: 0 },
      ]);
    });

    it('a stored 0 equal to the response 0: no write', async () => {
      mock(getPaymentById).mockResolvedValue(
        buildPayment(INSTALLMENT, 'Initial', { easyCreditInterest: 0, easyCreditTotalValue: 0 }),
      );
      client.getPayment.mockResolvedValue(ecPayment('PREAUTHORIZED', INSTALLMENT, { interest: 0, totalValue: 0 }));

      await handleGetPayment(PAYMENT_ID);

      expect(updatePayment).not.toHaveBeenCalled();
    });
  });
});

describe('handleCreatePayment discarding stale attempts', () => {
  const OLD = 'old-1';
  const redirectLinks = { urlSuccess: 'https://s', urlCancellation: 'https://c', urlDenial: 'https://d' };
  const customer = { customerStatus: 'NEW_CUSTOMER', customerSince: '2024-01-01', numberOfOrders: 0 } as any;
  const INSTALLMENT_CENTS = 30000;

  const staleCart = (ids: string[], overrides: Record<string, unknown> = {}) =>
    buildCart({
      lineItems: [],
      customLineItems: [],
      freezeStrategy: 'HardFreeze',
      paymentInfo: { payments: ids.map((id) => ({ typeId: 'payment', id })) },
      ...overrides,
    });
  const installmentCart = (ids: string[]) =>
    staleCart(ids, { totalPrice: { centAmount: INSTALLMENT_CENTS, currencyCode: 'EUR', fractionDigits: 2 } });

  const stale = (id: string, txState: string, method = INSTALLMENT_METHOD, paymentInterface = 'easycredit') => ({
    ...buildPayment(method, txState),
    id,
    paymentMethodInfo: { paymentInterface, method },
  });
  const givenPayments = (...payments: { id: string; [key: string]: unknown }[]) =>
    mock(getPaymentById).mockImplementation(async (id: string) => payments.find((payment) => payment.id === id));

  const create = (type: string) => handleCreatePayment('cart-1', redirectLinks, customer, type as any);
  const removeActions = (...ids: string[]) =>
    ids.map((id) => ({ action: 'removePayment', payment: { typeId: 'payment', id } }));
  // staleCart is frozen with HardFreeze, and the re-freeze keeps the cart's own strategy.
  const discardActions = (...ids: string[]) => [
    { action: 'unfreezeCart' },
    ...removeActions(...ids),
    { action: 'freezeCart', strategy: 'HardFreeze' },
  ];
  const addPaymentActions = [{ action: 'addPayment', payment: { typeId: 'payment', id: 'new-1' } }];
  const expectNothingMutated = () => {
    expect(updatePayment).not.toHaveBeenCalled();
    expect(updateCart).not.toHaveBeenCalled();
    expect(createPayment).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    jest.clearAllMocks();
    client.getPayment.mockReset();
    client.createPayment.mockReset();
    mock(initEasyCreditClient).mockReturnValue(client);
    client.getPayment.mockResolvedValue(ecPayment('PREAUTHORIZED'));
    client.createPayment.mockResolvedValue({
      transactionInformation: { decision: { decisionOutcome: 'POSITIVE' } },
      transactionId: 'ec-new',
      technicalTransactionId: 'tech-new',
    });
    mock(updatePayment).mockResolvedValue({});
    mock(createPayment).mockResolvedValue({ id: 'new-1' });
    mock(updateCart).mockImplementation(async (cart: unknown) => cart);
    setBillPaymentEnabled('1');
    mock(getShippingAddress).mockImplementation((cart: any) => cart.shippingAddress);
    mock(getShippingDestinations).mockImplementation((cart: any) => [cart.shippingAddress]);
    mock(getBillPaymentExclusion).mockResolvedValue({ productTypeKeys: [], customLineItems: [] });
    mock(getPaymentTypesAvailability).mockImplementation(async (amount: number) => ({
      INSTALLMENT_PAYMENT: {
        enabled: true,
        available: amount >= 200 && amount <= 5000,
        minAmount: 200,
        maxAmount: 5000,
      },
      BILL_PAYMENT: { enabled: true, available: amount >= 50 && amount <= 5000, minAmount: 50, maxAmount: 5000 },
    }));
  });

  it('installment to bill: an Initial attempt is failed and removed in one cart update, a new payment is created', async () => {
    const cart = staleCart([OLD]);
    mock(getCartById).mockResolvedValue(cart);
    givenPayments(stale(OLD, 'Initial', INSTALLMENT_METHOD));

    await create(BILL);

    expect(client.getPayment).toHaveBeenCalledWith('tech-1', expect.any(AbortSignal));
    expect(updatePayment).toHaveBeenNthCalledWith(1, expect.anything(), changeTransactionStateFailure);
    expect(updateCart).toHaveBeenCalledTimes(2);
    expect(updateCart).toHaveBeenNthCalledWith(1, cart, discardActions(OLD));
    expect(updateCart).toHaveBeenNthCalledWith(2, cart, addPaymentActions);
    expect(createPayment).toHaveBeenCalledTimes(1);
    expect(client.createPayment).toHaveBeenCalledTimes(1);
  });

  it('bill to installment: an Initial attempt is failed and removed in one cart update, a new payment is created', async () => {
    const cart = installmentCart([OLD]);
    mock(getCartById).mockResolvedValue(cart);
    givenPayments(stale(OLD, 'Initial', BILL));

    await create(INSTALLMENT);

    expect(updatePayment).toHaveBeenNthCalledWith(1, expect.anything(), changeTransactionStateFailure);
    expect(updateCart).toHaveBeenCalledTimes(2);
    expect(updateCart).toHaveBeenNthCalledWith(1, cart, discardActions(OLD));
    expect(updateCart).toHaveBeenNthCalledWith(2, cart, addPaymentActions);
    expect(createPayment).toHaveBeenCalledTimes(1);
  });

  it('only removes the stale attempts when the cart is not frozen, and freezes it afterwards', async () => {
    const cart = staleCart([OLD], { cartState: 'Active', freezeStrategy: undefined });
    mock(getCartById).mockResolvedValue(cart);
    givenPayments(stale(OLD, 'Initial'));

    await create(BILL);

    expect(updateCart).toHaveBeenNthCalledWith(1, cart, removeActions(OLD));
    expect(updateCart).toHaveBeenNthCalledWith(2, cart, [{ action: 'freezeCart' }]);
  });

  it.each(['SoftFreeze', 'HardFreeze', undefined])(
    're-freezes a cart frozen with %s with its own strategy, and does not freeze it again',
    async (freezeStrategy) => {
      const cart = staleCart([OLD], { freezeStrategy });
      mock(getCartById).mockResolvedValue(cart);
      givenPayments(stale(OLD, 'Initial'));

      await create(BILL);

      expect(updateCart).toHaveBeenCalledTimes(2);
      expect(updateCart).toHaveBeenNthCalledWith(1, cart, [
        { action: 'unfreezeCart' },
        ...removeActions(OLD),
        { action: 'freezeCart', strategy: freezeStrategy },
      ]);
      expect(updateCart).toHaveBeenNthCalledWith(2, cart, addPaymentActions);
    },
  );

  it('discards every stale attempt in one cart update', async () => {
    const cart = staleCart([OLD, 'old-2']);
    mock(getCartById).mockResolvedValue(cart);
    givenPayments(stale(OLD, 'Initial'), stale('old-2', 'Initial', BILL));

    await create(BILL);

    expect(updateCart).toHaveBeenNthCalledWith(1, cart, discardActions(OLD, 'old-2'));
    expect(updatePayment).toHaveBeenCalledTimes(3);
  });

  it('a Failure payment is ignored', async () => {
    mock(getCartById).mockResolvedValue(staleCart([OLD]));
    givenPayments(stale(OLD, 'Failure'));

    await create(BILL);

    expect(client.getPayment).not.toHaveBeenCalled();
    expect(updatePayment).toHaveBeenCalledTimes(1);
    expect(updateCart).toHaveBeenCalledTimes(1);
    expect(updateCart).toHaveBeenCalledWith(expect.anything(), addPaymentActions);
  });

  it('a payment without an authorization transaction is ignored', async () => {
    mock(getCartById).mockResolvedValue(staleCart([OLD]));
    givenPayments({ ...stale(OLD, 'Initial'), transactions: [] });

    await create(BILL);

    expect(updateCart).toHaveBeenCalledTimes(1);
  });

  it('a non-easyCredit payment is left alone', async () => {
    mock(getCartById).mockResolvedValue(staleCart([OLD]));
    givenPayments(stale(OLD, 'Initial', 'card', 'otherpsp'));

    await create(BILL);

    expect(client.getPayment).not.toHaveBeenCalled();
    expect(updatePayment).toHaveBeenCalledTimes(1);
    expect(updatePayment).not.toHaveBeenCalledWith(expect.anything(), changeTransactionStateFailure);
    expect(updateCart).toHaveBeenCalledTimes(1);
    expect(updateCart).toHaveBeenCalledWith(expect.anything(), addPaymentActions);
  });

  it('matches the easyCredit interface case-insensitively', async () => {
    const cart = staleCart([OLD]);
    mock(getCartById).mockResolvedValue(cart);
    givenPayments(stale(OLD, 'Initial', INSTALLMENT, 'EasyCredit'));

    await create(BILL);

    expect(updateCart).toHaveBeenNthCalledWith(1, cart, discardActions(OLD));
  });

  it.each(['Pending', 'Success'])('a %s payment refuses with PaymentInProgress', async (state) => {
    mock(getCartById).mockResolvedValue(staleCart([OLD]));
    givenPayments(stale(OLD, state));

    const error = await create(BILL).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Errorx);
    expect(error).toMatchObject({ code: 'PaymentInProgress', httpErrorStatus: 400 });
    expect((error as Errorx).skipLog).toBeFalsy();
    expect(client.getPayment).not.toHaveBeenCalled();
    expectNothingMutated();
  });

  it('[Initial, Pending] refuses and mutates nothing', async () => {
    mock(getCartById).mockResolvedValue(staleCart([OLD, 'old-2']));
    givenPayments(stale(OLD, 'Initial'), stale('old-2', 'Pending', BILL));

    await expect(create(BILL)).rejects.toMatchObject({ code: 'PaymentInProgress' });

    expectNothingMutated();
  });

  it('Initial with easyCredit AUTHORIZED refuses', async () => {
    mock(getCartById).mockResolvedValue(staleCart([OLD]));
    givenPayments(stale(OLD, 'Initial'));
    client.getPayment.mockResolvedValue(ecPayment('AUTHORIZED'));

    await expect(create(BILL)).rejects.toMatchObject({ code: 'PaymentInProgress', httpErrorStatus: 400 });

    expectNothingMutated();
  });

  it.each([
    ['an HTTP 404', () => Promise.reject(new Errorx({ code: 'NotFound', message: 'x', httpErrorStatus: 404 }))],
    ['an HTTP 410', () => Promise.reject(new Errorx({ code: 'Gone', message: 'x', httpErrorStatus: 410 }))],
    ['status EXPIRED', () => Promise.resolve(ecPayment('EXPIRED'))],
    ['status DECLINED', () => Promise.resolve(ecPayment('DECLINED'))],
    ['status OPEN', () => Promise.resolve(ecPayment('OPEN'))],
  ])('a lookup answering %s discards the attempt', async (_name, lookup) => {
    const cart = staleCart([OLD]);
    mock(getCartById).mockResolvedValue(cart);
    givenPayments(stale(OLD, 'Initial'));
    client.getPayment.mockImplementation(lookup);

    await create(BILL);

    expect(updateCart).toHaveBeenNthCalledWith(1, cart, discardActions(OLD));
  });

  it.each([
    ['an HTTP 500', new Errorx({ code: 'Boom', message: 'x', httpErrorStatus: 500 })],
    ['a network error', new Error('socket hang up')],
    ['a timeout', Object.assign(new Error('timeout'), { name: 'TimeoutError' })],
  ])('a lookup failing with %s refuses', async (_name, failure) => {
    mock(getCartById).mockResolvedValue(staleCart([OLD]));
    givenPayments(stale(OLD, 'Initial'));
    client.getPayment.mockRejectedValue(failure);

    await expect(create(BILL)).rejects.toMatchObject({ code: 'PaymentInProgress' });

    expectNothingMutated();
  });

  // Each read of an id answers the next payment of its sequence; the last one repeats.
  const givenReads = (sequences: Record<string, { id: string }[]>) => {
    const reads: Record<string, number> = {};
    mock(getPaymentById).mockImplementation(async (id: string) => {
      const sequence = sequences[id];
      const index = Math.min(reads[id] ?? 0, sequence.length - 1);
      reads[id] = (reads[id] ?? 0) + 1;
      return sequence[index];
    });
  };

  it.each(['Pending', 'Success'])(
    'an attempt that moved to %s after the read pass is not failed or removed',
    async (state) => {
      mock(getCartById).mockResolvedValue(staleCart([OLD]));
      givenReads({ [OLD]: [stale(OLD, 'Initial'), stale(OLD, state)] });

      await expect(create(BILL)).rejects.toMatchObject({ code: 'PaymentInProgress' });

      expectNothingMutated();
    },
  );

  it('an attempt that moved on mid-loop leaves earlier ones failed but attached', async () => {
    mock(getCartById).mockResolvedValue(staleCart([OLD, 'old-2']));
    givenReads({
      [OLD]: [stale(OLD, 'Initial')],
      'old-2': [stale('old-2', 'Initial', BILL), stale('old-2', 'Pending', BILL)],
    });

    await expect(create(BILL)).rejects.toMatchObject({ code: 'PaymentInProgress' });

    expect(updatePayment).toHaveBeenCalledTimes(1);
    expect(updatePayment).toHaveBeenCalledWith(expect.objectContaining({ id: OLD }), changeTransactionStateFailure);
    expect(updateCart).not.toHaveBeenCalled();
    expect(createPayment).not.toHaveBeenCalled();
  });

  it('an attempt that moved to Pending after a 409 is not failed on the retry', async () => {
    mock(getCartById).mockResolvedValue(staleCart([OLD]));
    givenReads({ [OLD]: [stale(OLD, 'Initial'), stale(OLD, 'Initial'), stale(OLD, 'Pending')] });
    mock(updatePayment).mockRejectedValueOnce({ httpErrorStatus: 409 });

    await expect(create(BILL)).rejects.toMatchObject({ code: 'PaymentInProgress' });

    expect(updatePayment).toHaveBeenCalledTimes(1);
    expect(updateCart).not.toHaveBeenCalled();
    expect(createPayment).not.toHaveBeenCalled();
  });

  it('an attempt already Failed at the write pass (concurrent cancel) is still discarded', async () => {
    const cart = staleCart([OLD]);
    mock(getCartById).mockResolvedValue(cart);
    givenReads({ [OLD]: [stale(OLD, 'Initial'), stale(OLD, 'Failure')] });

    await create(BILL);

    expect(updatePayment).not.toHaveBeenCalledWith(expect.anything(), changeTransactionStateFailure);
    expect(updateCart).toHaveBeenNthCalledWith(1, cart, discardActions(OLD));
    expect(createPayment).toHaveBeenCalledTimes(1);
  });

  it('no payments: no extra commercetools call', async () => {
    mock(getCartById).mockResolvedValue(staleCart([], { paymentInfo: undefined }));

    await create(BILL);

    expect(getPaymentById).not.toHaveBeenCalled();
    expect(updateCart).toHaveBeenCalledTimes(1);
    expect(updateCart).toHaveBeenCalledWith(expect.anything(), addPaymentActions);
  });

  it('validation failure leaves the cart untouched', async () => {
    mock(getCartById).mockResolvedValue(staleCart([OLD], { shippingAddress: { ...address, streetName: 'Anders' } }));
    givenPayments(stale(OLD, 'Initial'));

    await expect(create(BILL)).rejects.toMatchObject({
      errors: [expect.objectContaining({ code: 'AddressesUnmatched' })],
    });

    expect(getPaymentById).not.toHaveBeenCalled();
    expectNothingMutated();
  });

  it('an unfreeze that reprices the cart triggers the existing re-validation', async () => {
    const cart = staleCart([OLD]);
    mock(getCartById).mockResolvedValue(cart);
    givenPayments(stale(OLD, 'Initial'));
    const repriced = { ...cart, totalPrice: { centAmount: 600000, currencyCode: 'EUR', fractionDigits: 2 } };
    mock(updateCart).mockResolvedValueOnce(repriced);

    await expect(create(BILL)).rejects.toMatchObject({
      errors: [expect.objectContaining({ code: 'InvalidAmount' })],
    });

    expect(createPayment).not.toHaveBeenCalled();
  });
});
