import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Cart, Errorx, MultiErrorx } from '@commercetools/connect-payments-sdk';
import { handleCreatePayment } from '../../src/services/payment.service';
import * as webshopService from '../../src/services/webshop.service';
import { getCartById, updateCart } from '../../src/commercetools/cart.commercetools';
import { createPayment, updatePayment } from '../../src/commercetools/payment.commercetools';
import { getCustomObjectByKey } from '../../src/commercetools/customObject.commercetools';
import { getProductTypesByKeys } from '../../src/commercetools/productType.commercetools';
import { resetBillPaymentRestrictionCache } from '../../src/services/billPaymentRestriction.service';
import { initEasyCreditClient } from '../../src/client/easycredit.client';
import { ECTransactionCustomerRelationship, ECTransactionPaymentType } from '../../src/types/payment.types';

// Runs the real service, webshop service, validators and config; only the external APIs are mocked.
jest.mock('../../src/commercetools/cart.commercetools');
jest.mock('../../src/commercetools/payment.commercetools');
jest.mock('../../src/client/easycredit.client');
jest.mock('../../src/commercetools/customObject.commercetools');
jest.mock('../../src/commercetools/productType.commercetools');

const address = {
  country: 'DE',
  firstName: 'Max',
  lastName: 'Mustermann',
  streetName: 'Hauptstr.',
  city: 'Berlin',
  postalCode: '10115',
};

const webshopInfo = {
  availability: true,
  installmentPaymentActive: true,
  minInstallmentValue: 200,
  maxInstallmentValue: 10000,
  billPaymentActive: true,
  minBillingValue: 50,
  maxBillingValue: 5000,
};

const BILL = ECTransactionPaymentType.ECTransactionBillPayment;
const INSTALLMENT = ECTransactionPaymentType.ECTransactionInstallmentPayment;

const redirectLinks = {
  urlSuccess: 'https://example.com',
  urlCancellation: 'https://example.com',
  urlDenial: 'https://example.com',
};

const buildCart = (cartState: string, cents: number, currencyCode = 'EUR') =>
  ({
    id: 'cart123',
    cartState,
    freezeStrategy: cartState === 'Frozen' ? 'HardFreeze' : undefined,
    billingAddress: address,
    shippingAddress: address,
    shipping: [],
    lineItems: [],
    customLineItems: [],
    itemShippingAddresses: [],
    totalPrice: { currencyCode, centAmount: cents, fractionDigits: 2 },
  }) as unknown as Cart;

const getErrorCodes = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => new Error('Expected the payment creation to be rejected, but it resolved'),
    (e: unknown) => e,
  );
  if (error instanceof MultiErrorx) {
    return error.errors.map(({ code, httpErrorStatus }) => ({ code, httpErrorStatus }));
  }
  if (error instanceof Errorx) {
    return [{ code: error.code, httpErrorStatus: error.httpErrorStatus }];
  }
  throw error;
};

describe('handleCreatePayment re-validates a cart repriced by the freeze', () => {
  let availabilitySpy: jest.SpiedFunction<typeof webshopService.getPaymentTypesAvailability>;
  let createECPaymentMock: jest.Mock;

  // The cart that freezeCart (updateCart) returns, possibly with another total.
  const mockFlow = (validated: Cart, frozen: Cart) => {
    jest.mocked(getCartById).mockResolvedValue(validated);
    jest.mocked(updateCart).mockImplementation(async (_cart, actions) => {
      const isFreeze = actions.some((a) => a.action === 'freezeCart');
      return (isFreeze ? frozen : { ...frozen, cartState: 'Active' }) as Cart;
    });
    jest.mocked(createPayment).mockResolvedValue({ id: 'payment123' } as Awaited<ReturnType<typeof createPayment>>);
    jest.mocked(updatePayment).mockResolvedValue({ id: 'payment123' } as Awaited<ReturnType<typeof updatePayment>>);
    jest
      .mocked(getCustomObjectByKey)
      .mockResolvedValue({ value: 'https://connector.example.com' } as Awaited<
        ReturnType<typeof getCustomObjectByKey>
      >);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    webshopService.resetWebshopInfoCache();
    resetBillPaymentRestrictionCache();
    createECPaymentMock = jest.fn(async () => ({
      technicalTransactionId: 'tech123',
      transactionId: 'tx123',
      redirectUrl: 'https://easycredit.example.com',
      transactionInformation: { status: 'OPEN', decision: { decisionOutcome: 'POSITIVE', decisionOutcomeText: '' } },
    }));
    jest.mocked(initEasyCreditClient).mockReturnValue({
      getWebshopInfo: jest.fn<() => Promise<unknown>>().mockResolvedValue(webshopInfo),
      createPayment: createECPaymentMock,
    } as unknown as ReturnType<typeof initEasyCreditClient>);
    availabilitySpy = jest.spyOn(webshopService, 'getPaymentTypesAvailability');
  });

  it('rejects a repriced Active cart above the bill maximum (Active -> freezeCart) and unfreezes it', async () => {
    const frozen = buildCart('Frozen', 510000);
    mockFlow(buildCart('Active', 500000), frozen);

    await expect(
      getErrorCodes(handleCreatePayment('cart123', redirectLinks, {} as ECTransactionCustomerRelationship, BILL)),
    ).resolves.toEqual([{ code: 'InvalidAmount', httpErrorStatus: 400 }]);

    expect(createPayment).not.toHaveBeenCalled();
    expect(createECPaymentMock).not.toHaveBeenCalled();
    expect(updateCart).toHaveBeenLastCalledWith(frozen, [{ action: 'unfreezeCart' }]);
  });

  it('keeps a cart the shop froze as it is, without re-freezing or re-validating', async () => {
    const shopFrozen = { ...buildCart('Frozen', 500000), freezeStrategy: 'SoftFreeze' } as Cart;
    mockFlow(shopFrozen, shopFrozen);

    await handleCreatePayment('cart123', redirectLinks, {} as ECTransactionCustomerRelationship, BILL);

    const actions = jest.mocked(updateCart).mock.calls.flatMap(([, a]) => a.map(({ action }) => action));
    expect(actions).toEqual(['addPayment']);
    expect(availabilitySpy).toHaveBeenCalledTimes(1);
    expect(createPayment).toHaveBeenCalledTimes(1);
    expect(createECPaymentMock).toHaveBeenCalledTimes(1);
  });

  it('re-validates when only the currency differs', async () => {
    mockFlow(buildCart('Active', 50000), buildCart('Frozen', 50000, 'USD'));

    await expect(
      getErrorCodes(handleCreatePayment('cart123', redirectLinks, {} as ECTransactionCustomerRelationship, BILL)),
    ).resolves.toEqual([expect.objectContaining({ httpErrorStatus: 400 })]);

    expect(createPayment).not.toHaveBeenCalled();
    expect(updateCart).toHaveBeenLastCalledWith(expect.anything(), [{ action: 'unfreezeCart' }]);
  });

  it('creates the payment when the repriced total is still within the limits', async () => {
    mockFlow(buildCart('Active', 50000), buildCart('Frozen', 60000));

    await handleCreatePayment('cart123', redirectLinks, {} as ECTransactionCustomerRelationship, INSTALLMENT);

    expect(availabilitySpy).toHaveBeenCalledTimes(2);
    expect(availabilitySpy).toHaveBeenLastCalledWith(600);
    expect(createPayment).toHaveBeenCalledTimes(1);
    expect(createECPaymentMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a repriced total', 60000],
    ['an unchanged total', 50000],
  ])('rejects BILL_PAYMENT if the frozen cart gained an excluded item with %s and unfreezes it', async (_, cents) => {
    const originalEnv = { ...process.env };
    process.env.BILL_PAYMENT_EXCLUDED_PRODUCT_TYPES = 'voucher';
    jest
      .mocked(getProductTypesByKeys)
      .mockResolvedValue([{ id: 'pt-voucher', key: 'voucher' }] as Awaited<ReturnType<typeof getProductTypesByKeys>>);
    const physicalItem = { id: 'li-physical', productType: { typeId: 'product-type', id: 'pt-physical' } };
    // For example a gift line item that a cart discount adds on recalculation.
    const voucherItem = { id: 'li-voucher', productType: { typeId: 'product-type', id: 'pt-voucher' } };
    const frozen = { ...buildCart('Frozen', cents), lineItems: [physicalItem, voucherItem] } as unknown as Cart;
    mockFlow({ ...buildCart('Active', 50000), lineItems: [physicalItem] } as unknown as Cart, frozen);

    try {
      await expect(
        getErrorCodes(handleCreatePayment('cart123', redirectLinks, {} as ECTransactionCustomerRelationship, BILL)),
      ).resolves.toEqual([{ code: 'BillPaymentExcludedItems', httpErrorStatus: 400 }]);
    } finally {
      process.env = originalEnv;
    }

    expect(availabilitySpy).toHaveBeenCalledTimes(2);
    expect(createPayment).not.toHaveBeenCalled();
    expect(createECPaymentMock).not.toHaveBeenCalled();
    expect(updateCart).toHaveBeenLastCalledWith(frozen, [{ action: 'unfreezeCart' }]);
  });

  it('fetches the availability once when the total and the items are unchanged', async () => {
    mockFlow(buildCart('Active', 50000), buildCart('Frozen', 50000));

    await handleCreatePayment('cart123', redirectLinks, {} as ECTransactionCustomerRelationship, INSTALLMENT);

    expect(availabilitySpy).toHaveBeenCalledTimes(1);
    expect(createPayment).toHaveBeenCalledTimes(1);
  });
});
