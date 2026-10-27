import { Address, Cart, Errorx, Payment } from '@commercetools/connect-payments-sdk';
import {
  validateAddresses,
  validateCurrency,
  validateECTransactionId,
  validateInitialOrPendingTransaction,
  validatePayment,
  validatePaymentAmount,
  validatePaymentTypeAvailability,
  validatePendingTransaction,
  validatePrivateCustomer,
  validateShippingDestinations,
  validateSuccessTransaction,
  validateTransaction,
} from '../../src/validators/payment.validators';
import { compareAddress } from '../../src/utils/commerceTools.utils';
import { convertCentsToEur } from '../../src/utils/app.utils';
import { EASYCREDIT_PAYMENT_METHOD } from '../../src/utils/constant.utils';
import { getPendingTransaction, getSuccessTransaction, getTransaction } from '../../src/utils/payment.utils';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { CTTransactionState, CTTransactionType, PaymentTypeExclusion } from '../../src/types/payment.types';

jest.mock('../../src/utils/commerceTools.utils', () => ({
  compareAddress: jest.fn(),
}));

jest.mock('../../src/utils/app.utils', () => ({
  convertCentsToEur: jest.fn(),
}));

jest.mock('../../src/utils/payment.utils', () => ({
  getPendingTransaction: jest.fn(),
  getSuccessTransaction: jest.fn(),
  getTransaction: jest.fn(),
}));

describe('Validation Functions', () => {
  const ecConfig = { webShopId: 'shop123' };
  let errors: Errorx[];

  beforeEach(() => {
    errors = [];
    jest.clearAllMocks();
  });

  describe('validateAddresses', () => {
    const validAddress = {
      firstName: 'Max',
      lastName: 'Mustermann',
      streetName: 'Musterstrasse',
      city: 'Berlin',
      postalCode: '10115',
      country: 'DE',
    } as Address;

    it('should push error if billing address is undefined', () => {
      validateAddresses(undefined, { country: 'DE' } as Address, ecConfig, errors);
      expect(errors).toHaveLength(2);
      expect(errors[0]).toEqual(
        expect.objectContaining({
          code: 'InvalidBillingAddress',
          httpErrorStatus: 400,
          message: 'Rechnungsadresse kann nicht gefunden werden.',
        }),
      );
    });

    it('should push error if shipping address is undefined', () => {
      validateAddresses({ country: 'DE' } as Address, undefined, ecConfig, errors);
      expect(errors).toHaveLength(2);
      expect(errors[0]).toEqual(
        expect.objectContaining({
          code: 'InvalidShippingAddress',
          httpErrorStatus: 400,
          message: 'Lieferadresse kann nicht gefunden werden.',
        }),
      );
    });

    it('should push error if addresses are unmatched or not in Germany', () => {
      (compareAddress as jest.Mock).mockReturnValue(false);
      validateAddresses({ ...validAddress, country: 'US' } as Address, validAddress, ecConfig, errors);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual(
        expect.objectContaining({
          code: 'AddressesUnmatched',
          httpErrorStatus: 400,
          message: 'Liefer- und Rechnungsadresse sind nicht identisch oder nicht in Deutschland.',
        }),
      );
    });

    it('should not push errors for valid addresses', () => {
      (compareAddress as jest.Mock).mockReturnValue(true);
      validateAddresses(validAddress, validAddress, ecConfig, errors);
      expect(errors).toHaveLength(0);
    });

    describe('InvalidAddress', () => {
      beforeEach(() => {
        (compareAddress as jest.Mock).mockReturnValue(true);
      });

      it.each([
        ['firstName', undefined],
        ['firstName', ''],
        ['firstName', '   '],
        ['lastName', undefined],
        ['lastName', ''],
        ['lastName', ' \t '],
        ['streetName', undefined],
        ['streetName', ''],
        ['streetName', '  '],
        ['city', undefined],
        ['city', ''],
        ['city', '  '],
        ['postalCode', undefined],
        ['postalCode', ''],
        ['postalCode', '1234'],
        ['postalCode', '123456'],
        ['postalCode', 'ABCDE'],
        ['postalCode', '1234 '],
        ['postalCode', ' 12345'],
        ['postalCode', '12345\n'],
      ])('should push InvalidAddress once if billing %s is %j', (field, value) => {
        const billing = { ...validAddress, [field]: value } as Address;
        validateAddresses(billing, billing, ecConfig, errors);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toEqual(
          expect.objectContaining({
            code: 'InvalidAddress',
            httpErrorStatus: 400,
            message: 'Die Adresse ist unvollständig oder ungültig.',
            fields: ecConfig,
          }),
        );
      });

      it('should push InvalidAddress only once if several billing fields are invalid', () => {
        const billing = { country: 'DE' } as Address;
        validateAddresses(billing, billing, ecConfig, errors);
        expect(errors.filter((e) => e.code === 'InvalidAddress')).toHaveLength(1);
        expect(errors).toHaveLength(1);
      });

      it('should accept a valid 5 digit postal code', () => {
        const billing = { ...validAddress, postalCode: '01067' };
        validateAddresses(billing, billing, ecConfig, errors);
        expect(errors).toHaveLength(0);
      });

      it('should report both InvalidAddress and AddressesUnmatched when addresses differ and billing is invalid', () => {
        (compareAddress as jest.Mock).mockReturnValue(false);
        validateAddresses({ ...validAddress, city: '' }, validAddress, ecConfig, errors);
        expect(errors.map((e) => e.code)).toEqual(['AddressesUnmatched', 'InvalidAddress']);
      });

      it('should only report AddressesUnmatched when addresses differ and billing is valid', () => {
        (compareAddress as jest.Mock).mockReturnValue(false);
        validateAddresses(validAddress, { ...validAddress, city: 'Other' }, ecConfig, errors);
        expect(errors.map((e) => e.code)).toEqual(['AddressesUnmatched']);
      });

      it('should not validate shipping fields on their own', () => {
        validateAddresses(validAddress, { ...validAddress, city: '' }, ecConfig, errors);
        expect(errors).toHaveLength(0);
      });

      it('should not push InvalidAddress if billing address is missing', () => {
        validateAddresses(undefined, { country: 'DE' } as Address, ecConfig, errors);
        expect(errors.map((e) => e.code)).toEqual(['InvalidBillingAddress', 'AddressesUnmatched']);
      });

      it('should not push InvalidAddress if shipping address is missing', () => {
        validateAddresses({ country: 'DE' } as Address, undefined, ecConfig, errors);
        expect(errors.map((e) => e.code)).toEqual(['InvalidShippingAddress', 'AddressesUnmatched']);
      });

      it('should not push InvalidAddress if both addresses are missing', () => {
        validateAddresses(undefined, undefined, ecConfig, errors);
        expect(errors.map((e) => e.code)).toEqual([
          'InvalidBillingAddress',
          'InvalidShippingAddress',
          'AddressesUnmatched',
        ]);
      });
    });
  });

  describe('validateCurrency', () => {
    it('should push error for invalid currency', () => {
      validateCurrency('USD', ecConfig, errors);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual(
        expect.objectContaining({
          code: 'InvalidCurrency',
          httpErrorStatus: 400,
          message: 'Die einzige verfügbare Währungsoption ist EUR.',
        }),
      );
    });

    it('should not push errors for valid currency', () => {
      validateCurrency('EUR', ecConfig, errors);
      expect(errors).toHaveLength(0);
    });
  });

  describe('validatePaymentTypeAvailability', () => {
    it('should not push errors if the payment type is available', () => {
      validatePaymentTypeAvailability(
        500,
        { enabled: true, available: true, minAmount: 200, maxAmount: 10000 },
        ecConfig,
        errors,
      );
      expect(errors).toHaveLength(0);
    });

    it.each<[PaymentTypeExclusion, string, number]>([
      ['cartItems', 'BillPaymentExcludedItems', 400],
      ['checkFailed', 'BillPaymentCheckFailed', 503],
    ])('should push %s as %s instead of InvalidAmount', (exclusion, code, httpErrorStatus) => {
      validatePaymentTypeAvailability(
        10,
        { enabled: true, available: false, exclusion, minAmount: 50, maxAmount: 5000 },
        ecConfig,
        errors,
      );
      expect(errors).toEqual([expect.objectContaining({ code, httpErrorStatus, fields: ecConfig })]);
    });

    it.each([100, 10001])('should push InvalidAmount with the given limits if amount %s is out of range', (amount) => {
      validatePaymentTypeAvailability(
        amount,
        { enabled: true, available: false, minAmount: 200, maxAmount: 10000 },
        ecConfig,
        errors,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual(
        expect.objectContaining({
          code: 'InvalidAmount',
          httpErrorStatus: 400,
          message: 'Die Summe des Warenkorbs muss zwischen 200€ und 10.000€ liegen.',
        }),
      );
    });

    it('should format the limits in German regardless of the runtime locale', () => {
      const toLocaleStringSpy = jest.spyOn(Number.prototype, 'toLocaleString');

      validatePaymentTypeAvailability(
        100,
        { enabled: true, available: false, minAmount: 1500, maxAmount: 10000 },
        ecConfig,
        errors,
      );

      expect(errors[0].message).toBe('Die Summe des Warenkorbs muss zwischen 1.500€ und 10.000€ liegen.');
      expect(toLocaleStringSpy.mock.calls).toEqual([['de-DE'], ['de-DE']]);
      toLocaleStringSpy.mockRestore();
    });

    it.each([10, 500, 6000])(
      'should push PaymentTypeNotAvailable if the payment type is disabled (amount %s)',
      (amount) => {
        validatePaymentTypeAvailability(
          amount,
          { enabled: false, available: false, minAmount: 50, maxAmount: 5000 },
          ecConfig,
          errors,
        );
        expect(errors).toHaveLength(1);
        expect(errors[0]).toEqual(
          expect.objectContaining({ code: 'PaymentTypeNotAvailable', httpErrorStatus: 400, fields: ecConfig }),
        );
      },
    );

    it('should push PaymentTypeNotAvailable if no limits are known', () => {
      validatePaymentTypeAvailability(500, { enabled: true, available: false }, ecConfig, errors);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual(expect.objectContaining({ code: 'PaymentTypeNotAvailable' }));
    });
  });

  describe('validatePrivateCustomer', () => {
    const ecConfig = { webShopId: 'webShopId123' };

    it.each([
      ['a business unit', { businessUnit: { typeId: 'business-unit', key: 'acme' } }, []],
      ['a billing address company', { billingAddress: { country: 'DE', company: 'ACME GmbH' } }, []],
      ['a shipping address company', {}, [{ country: 'DE', company: 'ACME GmbH' }]],
      ['a company at a later shipping destination', {}, [{ country: 'DE' }, { country: 'DE', company: 'ACME GmbH' }]],
    ])('should reject a cart with %s', (_, cart, shippingDestinations) => {
      const errors: Errorx[] = [];

      validatePrivateCustomer(cart as unknown as Cart, shippingDestinations as Address[], ecConfig, errors);

      expect(errors).toEqual([
        expect.objectContaining({ code: 'CorporateCustomerNotAllowed', httpErrorStatus: 400, fields: ecConfig }),
      ]);
    });

    it('should accept destinations with absent, empty or whitespace-only companies', () => {
      const errors: Errorx[] = [];
      const shippingDestinations = [undefined, '', '  '].map((company) => ({ country: 'DE', company }) as Address);

      validatePrivateCustomer(
        { billingAddress: { country: 'DE', company: ' ' } } as unknown as Cart,
        shippingDestinations,
        ecConfig,
        errors,
      );

      expect(errors).toHaveLength(0);
    });
  });

  describe('validateShippingDestinations', () => {
    const ecConfig = { webShopId: 'webShopId123' };
    const billingAddress = { country: 'DE', firstName: 'Max', streetName: 'Hauptstr.', city: 'Berlin' } as Address;

    beforeEach(() => {
      jest
        .mocked(compareAddress)
        .mockImplementation(
          jest.requireActual<typeof import('../../src/utils/commerceTools.utils')>(
            '../../src/utils/commerceTools.utils',
          ).compareAddress,
        );
    });

    it('should accept destinations that all match the billing address', () => {
      const errors: Errorx[] = [];

      validateShippingDestinations(billingAddress, [billingAddress, { ...billingAddress }], ecConfig, errors);

      expect(errors).toHaveLength(0);
    });

    it.each([
      ['a different address', { ...billingAddress, streetName: 'Nebenstr.' }],
      ['a destination outside Germany', { ...billingAddress, country: 'AT' }],
    ])('should reject %s at a later destination', (_, destination) => {
      const errors: Errorx[] = [];

      validateShippingDestinations(billingAddress, [billingAddress, destination], ecConfig, errors);

      expect(errors).toEqual([
        expect.objectContaining({ code: 'AddressesUnmatched', httpErrorStatus: 400, fields: ecConfig }),
      ]);
    });

    it('should not report AddressesUnmatched twice', () => {
      const errors: Errorx[] = [];
      validateAddresses(billingAddress, { ...billingAddress, city: 'Hamburg' }, ecConfig, errors);

      validateShippingDestinations(billingAddress, [{ ...billingAddress, city: 'Hamburg' }], ecConfig, errors);

      expect(errors.filter(({ code }) => code === 'AddressesUnmatched')).toHaveLength(1);
    });
  });

  describe('validatePayment', () => {
    it('should throw error for invalid payment method', () => {
      const payment: Payment = {
        paymentMethodInfo: {
          paymentInterface: 'INVALID_METHOD',
        },
      } as unknown as Payment;

      expect(() => validatePayment(payment)).toThrow('Invalid payment method');
    });

    it('should not throw error for valid payment method', () => {
      const payment: Payment = {
        paymentMethodInfo: {
          paymentInterface: EASYCREDIT_PAYMENT_METHOD,
        },
      } as unknown as Payment;

      expect(() => validatePayment(payment)).not.toThrow();
    });
  });

  describe('validatePendingTransaction', () => {
    it('should throw error if pending transaction is missing interactionId', () => {
      (getPendingTransaction as jest.Mock).mockReturnValue({});
      const payment: Payment = {} as unknown as Payment;

      expect(() => validatePendingTransaction(payment)).toThrow('Missing pending transaction');
    });

    it('should not throw error if pending transaction is valid', () => {
      (getPendingTransaction as jest.Mock).mockReturnValue({ interactionId: 'transaction123' });
      const payment: Payment = {} as unknown as Payment;

      expect(() => validatePendingTransaction(payment)).not.toThrow();
    });
  });

  describe('validateSuccessTransaction', () => {
    it('should throw error if success transaction is missing interactionId', () => {
      (getSuccessTransaction as jest.Mock).mockReturnValue({});
      const payment: Payment = {} as unknown as Payment;

      expect(() => validateSuccessTransaction(payment)).toThrow('Missing success transaction');
    });

    it('should not throw error if success transaction is valid', () => {
      (getSuccessTransaction as jest.Mock).mockReturnValue({ interactionId: 'transaction123' });
      const payment: Payment = {} as unknown as Payment;

      expect(() => validateSuccessTransaction(payment)).not.toThrow();
    });
  });

  describe('validateInitialOrPendingTransaction', () => {
    it('should throw error if there is no initial or pending transaction', () => {
      const payment: Payment = {
        transactions: [],
      } as unknown as Payment;

      expect(() => validateInitialOrPendingTransaction(payment)).toThrow(
        'No interactionId found in any initial or pending transaction',
      );
    });

    it('should throw error if there is no interactionId in any initial or pending transaction', () => {
      (getPendingTransaction as jest.Mock).mockReturnValue({ interactionId: 'transaction123' });
      const payment: Payment = {
        transactions: [
          {
            type: CTTransactionType.Authorization,
            state: CTTransactionState.Initial,
          },
          {
            type: CTTransactionType.Authorization,
            state: CTTransactionState.Initial,
          },
          {
            type: CTTransactionType.Authorization,
            state: CTTransactionState.Pending,
          },
        ],
      } as unknown as Payment;

      expect(() => validateInitialOrPendingTransaction(payment)).toThrow(
        'No interactionId found in any initial or pending transaction',
      );
    });

    it('should not throw error if there is a interactionId in an initial or pending transaction', () => {
      (getPendingTransaction as jest.Mock).mockReturnValue({ interactionId: 'transaction123' });
      const payment: Payment = {
        transactions: [
          {
            type: CTTransactionType.Authorization,
            state: CTTransactionState.Initial,
          },
          {
            type: CTTransactionType.Authorization,
            state: CTTransactionState.Initial,
            interactionId: 'transaction123',
          },
          {
            type: CTTransactionType.Authorization,
            state: CTTransactionState.Pending,
          },
        ],
      } as unknown as Payment;

      expect(() => validateInitialOrPendingTransaction(payment)).not.toThrow();
    });
  });

  describe('validateTransaction', () => {
    it('should throw error if transaction is missing interactionId', () => {
      (getTransaction as jest.Mock).mockReturnValue({});
      const payment: Payment = {} as unknown as Payment;

      expect(() => validateTransaction(payment)).toThrow('Missing transaction');
    });

    it('should not throw error if pending transaction is valid', () => {
      (getTransaction as jest.Mock).mockReturnValue({ interactionId: 'transaction123' });
      const payment: Payment = {} as unknown as Payment;

      expect(() => validateTransaction(payment)).not.toThrow();
    });
  });

  describe('validatePaymentAmount', () => {
    it('should throw error if payment amount is smaller than the refund one', () => {
      (getTransaction as jest.Mock).mockReturnValue({});
      (convertCentsToEur as jest.Mock).mockReturnValue(10);
      const payment: Payment = {
        amountPlanned: {
          centAmount: 1000,
          fractionDigits: 2,
        },
      } as unknown as Payment;

      expect(() => validatePaymentAmount(payment, 300)).toThrow(
        'The refund amount cannot be greater than the payment amount and must be greater than 0',
      );
    });

    it('should not throw error if payment amount is greater than or equal the refund one', () => {
      (getTransaction as jest.Mock).mockReturnValue({ interactionId: 'transaction123' });
      const payment: Payment = {
        amountPlanned: {
          centAmount: 1000,
          fractionDigits: 2,
        },
      } as unknown as Payment;

      expect(() => validatePaymentAmount(payment, 10)).not.toThrow();
    });
  });

  describe('validateECTransactionId', () => {
    it('should throw error if easy credit transaction id not valid', () => {
      expect(() => validateECTransactionId('abc')).toThrow('Invalid transaction ID format.');

      expect(() => validateECTransactionId('123')).toThrow('Invalid transaction ID format.');

      expect(() => validateECTransactionId('ABC_123')).toThrow('Invalid transaction ID format.');

      expect(() => validateECTransactionId('ABCDEF123')).toThrow('Invalid transaction ID format.');
    });

    it('should not throw error if easy credit transaction id valid', () => {
      expect(() => validateECTransactionId('EWZEN7')).not.toThrow();
    });
  });
});
