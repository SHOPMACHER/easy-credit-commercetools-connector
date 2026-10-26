import { Cart, Payment } from '@commercetools/connect-payments-sdk';
import {
  getAddedRefundTransaction,
  getCompletedRefunds,
  getPayment,
  getPaymentType,
  getPendingRefundTransactions,
  getPendingTransaction,
  getSuccessTransaction,
  getTransaction,
} from '../../src/utils/payment.utils'; // Adjust the import path as necessary
import {
  CTTransactionState,
  CTTransactionType,
  ECBooking,
  ECTransactionPaymentType,
} from '../../src/types/payment.types';
import { EASYCREDIT_PAYMENT_METHOD } from '../../src/utils/constant.utils';
import { describe, expect, it } from '@jest/globals';

describe('Payment Utility Functions', () => {
  describe('getAddedRefundTransaction', () => {
    const refund = (id: string, state: CTTransactionState) => ({ id, type: CTTransactionType.Refund, state });
    const paymentOf = (...transactions: object[]) => ({ transactions }) as unknown as Payment;
    const older = refund('older', CTTransactionState.Initial);

    it('should return the Initial refund that the update added', () => {
      const added = refund('added', CTTransactionState.Initial);

      expect(getAddedRefundTransaction(paymentOf(older), paymentOf(older, added))?.id).toBe('added');
    });

    it('should find the added refund wherever CT puts it in the array', () => {
      const added = refund('added', CTTransactionState.Initial);

      expect(getAddedRefundTransaction(paymentOf(older), paymentOf(added, older))?.id).toBe('added');
    });

    it('should not fall back to an older Initial refund of another request', () => {
      const added = refund('added', CTTransactionState.Pending);

      expect(getAddedRefundTransaction(paymentOf(older), paymentOf(older, added))).toBeUndefined();
    });

    it('should return undefined when nothing was added', () => {
      expect(getAddedRefundTransaction(paymentOf(older), paymentOf(older))).toBeUndefined();
    });
  });

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

  describe('getSuccessTransaction', () => {
    it('should return the success transaction if it exists', () => {
      const payment: Payment = {
        transactions: [
          { type: CTTransactionType.Authorization, state: CTTransactionState.Success },
          { type: CTTransactionType.Chargeback, state: CTTransactionState.Initial },
        ],
      } as unknown as Payment;

      const result = getSuccessTransaction(payment);
      expect(result).toEqual({ type: CTTransactionType.Authorization, state: CTTransactionState.Success });
    });

    it('should return undefined if no success transaction exists', () => {
      const payment: Payment = {
        transactions: [{ type: CTTransactionType.Charge, state: CTTransactionState.Success }],
      } as unknown as Payment;

      const result = getPendingTransaction(payment);
      expect(result).toBeUndefined();
    });
  });

  describe('getTransaction', () => {
    it('should return the transaction if it exists', () => {
      const payment: Payment = {
        transactions: [{ type: CTTransactionType.Authorization }],
      } as unknown as Payment;

      const result = getTransaction(payment);
      expect(result).toEqual({ type: CTTransactionType.Authorization });
    });

    it('should return undefined if no transaction exists', () => {
      const payment: Payment = {
        transactions: [{ type: CTTransactionType.Charge, state: CTTransactionState.Success }],
      } as unknown as Payment;

      const result = getTransaction(payment);
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

  describe('getPendingRefundTransactions', () => {
    it('should return the pending refund transactions if they exist', () => {
      const payment = {
        transactions: [
          {
            id: 'transaction1',
            type: CTTransactionType.Refund,
            state: CTTransactionState.Pending,
          },
          {
            id: 'transaction2',
            type: CTTransactionType.Refund,
            state: CTTransactionState.Initial,
          },
          {
            id: 'transaction3',
            type: CTTransactionType.Refund,
            state: CTTransactionState.Pending,
          },
        ],
      } as Payment;

      const expectedResult = [payment.transactions[0], payment.transactions[2]];

      expect(getPendingRefundTransactions(payment)).toStrictEqual(expectedResult);
    });
  });

  describe('getCompletedRefunds', () => {
    it('should return the completed refunds if they exist', () => {
      const ecBookings = [
        {
          bookingType: 'RefundBooking',
          uuid: 'b6731d8c-27d0-4a82-ac35-5d19c0a1f5c8',
          created: '2024-10-29T10:08:35+01:00',
          type: 'REFUND',
          status: 'DONE',
          message: null,
          amount: 12.0,
          bookingId: 'bookingId1',
        },
        {
          bookingType: 'ApiBooking',
          uuid: '4799d92d-e8e2-4d79-9608-9b6d3b0c7dec',
          created: '2024-10-29T10:09:00+01:00',
          type: 'NOTIFY',
          status: 'DONE',
          message: null,
        },
        {
          bookingType: 'RefundBooking',
          uuid: '00a7da4d-fae1-4013-9f23-a103485c358d',
          created: '2024-10-29T10:12:28+01:00',
          type: 'REFUND',
          status: 'PENDING',
          message: null,
          amount: 3.0,
          bookingId: 'bookingId2',
        },
        {
          bookingType: 'RefundBooking',
          uuid: 'd0ed5b26-8fe8-4b9a-a4a4-476b0c530c36',
          created: '2024-10-29T11:43:12+01:00',
          type: 'REFUND',
          status: 'DONE',
          message: null,
          amount: 3.0,
          bookingId: 'bookingId3',
        },
      ] as unknown as ECBooking[];

      const expectedResult = [ecBookings[0], ecBookings[3]];

      expect(getCompletedRefunds(ecBookings)).toStrictEqual(expectedResult);
    });
  });

  describe('getPaymentType', () => {
    const withMethod = (method?: string) =>
      ({ paymentMethodInfo: method === undefined ? undefined : { method } }) as unknown as Payment;

    it('should return bill for BILL_PAYMENT', () => {
      expect(getPaymentType(withMethod('BILL_PAYMENT'))).toBe(ECTransactionPaymentType.ECTransactionBillPayment);
    });

    it.each([['INSTALLMENT_PAYMENT'], ['easycredit'], ['something-else'], [undefined]])(
      'should return installment for %p',
      (method) => {
        expect(getPaymentType(withMethod(method))).toBe(ECTransactionPaymentType.ECTransactionInstallmentPayment);
      },
    );
  });
});
