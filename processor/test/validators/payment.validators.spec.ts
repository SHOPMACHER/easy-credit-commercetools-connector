import { Address, Errorx, Payment } from '@commercetools/connect-payments-sdk';
import {
  validateAddresses,
  validateCurrency,
  validateCartAmount,
  validatePayment,
  validatePendingTransaction,
  validateTransaction,
  validateInitialOrPendingTransaction,
} from '../../src/validators/payment.validators';
import { compareAddress } from '../../src/utils/commerceTools.utils';
import { convertCentsToEur } from '../../src/utils/app.utils';
import { EASYCREDIT_PAYMENT_METHOD } from '../../src/utils/constant.utils';
import { getPendingTransaction, getTransaction } from '../../src/utils/payment.utils';
import { describe, jest, it, expect, beforeEach } from '@jest/globals';
import { CTTransactionState, CTTransactionType } from '../../src/types/payment.types';

jest.mock('../../src/utils/commerceTools.utils', () => ({
  compareAddress: jest.fn(),
}));

jest.mock('../../src/utils/app.utils', () => ({
  convertCentsToEur: jest.fn(),
}));

jest.mock('../../src/utils/payment.utils', () => ({
  getPendingTransaction: jest.fn(),
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
      validateAddresses({ country: 'US' } as Address, { country: 'DE' } as Address, ecConfig, errors);
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
      validateAddresses({ country: 'DE' } as Address, { country: 'DE' } as Address, ecConfig, errors);
      expect(errors).toHaveLength(0);
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

  describe('validateCartAmount', () => {
    it('should push error if amount is below MIN_CART_AMOUNT', () => {
      (convertCentsToEur as jest.Mock).mockReturnValue(5);
      validateCartAmount(500, 2, ecConfig, errors);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual(
        expect.objectContaining({
          code: 'InvalidAmount',
          httpErrorStatus: 400,
          message: expect.stringContaining('zwischen'),
        }),
      );
    });

    it('should push error if amount is above MAX_CART_AMOUNT', () => {
      (convertCentsToEur as jest.Mock).mockReturnValue(10001);
      validateCartAmount(100100, 2, ecConfig, errors);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual(
        expect.objectContaining({
          code: 'InvalidAmount',
          httpErrorStatus: 400,
          message: expect.stringContaining('zwischen'),
        }),
      );
    });

    it('should not push errors for valid cart amount', () => {
      (convertCentsToEur as jest.Mock).mockReturnValue(200);
      validateCartAmount(5000, 2, ecConfig, errors);
      expect(errors).toHaveLength(0);
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
});
