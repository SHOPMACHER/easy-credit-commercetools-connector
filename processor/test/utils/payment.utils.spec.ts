import { Cart, Payment } from '@commercetools/connect-payments-sdk';
import { getPendingTransaction, getPayment } from '../../src/utils/payment.utils'; // Adjust the import path as necessary
import { CTTransactionState, CTTransactionType } from '../../src/types/payment.types';
import { EASYCREDIT_PAYMENT_METHOD } from '../../src/utils/constant.utils';

describe('Payment Utility Functions', () => {
  describe('getPendingTransaction', () => {
    it('should return the pending transaction if it exists', () => {
      const payment: Payment = {
        transactions: [
          { type: CTTransactionType.Authorization, state: CTTransactionState.Pending },
          { type: CTTransactionType.Chargeback, state: CTTransactionState.Initial },
        ],
      } as unknown as Payment;

      const result = getPendingTransaction(payment);
      expect(result).toEqual({ type: CTTransactionType.Authorization, state: CTTransactionState.Pending });
    });

    it('should return undefined if no pending transaction exists', () => {
      const payment: Payment = {
        transactions: [{ type: CTTransactionType.Charge, state: CTTransactionState.Success }],
      } as unknown as Payment;

      const result = getPendingTransaction(payment);
      expect(result).toBeUndefined();
    });
  });

  describe('getPayment', () => {
    it('should return the payment if it matches the EASYCREDIT payment method', () => {
      const cart: Cart = {
        paymentInfo: {
          payments: [
            {
              obj: {
                paymentMethodInfo: {
                  paymentInterface: EASYCREDIT_PAYMENT_METHOD,
                },
              },
            },
            {
              obj: {
                paymentMethodInfo: {
                  paymentInterface: 'OTHER_PAYMENT_METHOD',
                },
              },
            },
          ],
        },
      } as unknown as Cart;

      const result = getPayment(cart);
      expect(result).toEqual(cart.paymentInfo?.payments[0]);
    });

    it('should return undefined if no matching payment exists', () => {
      const cart: Cart = {
        paymentInfo: {
          payments: [
            {
              obj: {
                paymentMethodInfo: {
                  paymentInterface: 'OTHER_PAYMENT_METHOD',
                },
              },
            },
          ],
        },
      } as unknown as Cart;

      const result = getPayment(cart);
      expect(result).toBeUndefined();
    });

    it('should return undefined if paymentInfo or payments is undefined', () => {
      const cart: Cart = {
        paymentInfo: {},
      } as unknown as Cart;

      const result = getPayment(cart);
      expect(result).toBeUndefined();
    });
  });
});
