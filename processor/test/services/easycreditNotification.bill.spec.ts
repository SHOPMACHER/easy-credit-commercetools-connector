import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { handleEasyCreditNotification } from '../../src/services/easycreditNotification.service';
import {
  getPaymentByEasyCreditRefundBookingId,
  getPaymentById,
  updatePayment,
} from '../../src/commercetools/payment.commercetools';
import { initEasyCreditClient } from '../../src/client/easycredit.client';
import { log } from '../../src/libs/logger';
import capturedAndRefunded from '../fixtures/easycredit/merchantTransaction.bill.capturedAndRefunded.json';
import refundedBeforeCapture from '../fixtures/easycredit/merchantTransaction.bill.refundedBeforeCapture.json';

// Booking filters and mappers run for real on merchant transactions recorded in the easyCredit sandbox.
jest.mock('../../src/commercetools/payment.commercetools');
jest.mock('../../src/commercetools/customObject.commercetools');
jest.mock('../../src/client/easycredit.client');
jest.mock('../../src/libs/logger');
jest.mock('../../src/utils/config.utils', () => ({
  readConfiguration: jest.fn(() => ({
    easyCredit: { webShopId: 'webshop-1' },
    commerceTools: { projectKey: 'projectKey123', clientId: 'clientId123', clientSecret: 'clientSecret', region: 'eu' },
  })),
}));

type AnyFn = (...args: any[]) => any;
const mock = (fn: unknown) => fn as jest.Mock<AnyFn>;

const authorization = (interactionId: string) => ({
  id: 'auth-1',
  type: 'Authorization',
  state: 'Success',
  interactionId,
  amount: { centAmount: 54900, currencyCode: 'EUR', fractionDigits: 2 },
  custom: { type: { typeId: 'type', id: 'type-1' }, fields: { easyCreditTechnicalTransactionId: 'tech-1' } },
});

const buildPayment = (id: string, interactionId: string, transactions: object[]) => ({
  id,
  version: 7,
  paymentMethodInfo: { paymentInterface: 'easycredit', method: 'BILL_PAYMENT' },
  transactions: [authorization(interactionId), ...transactions],
});

const notifyWith = async (merchantTransaction: object, payment: object) => {
  mock(initEasyCreditClient).mockReturnValue({
    getMerchantTransaction: jest.fn<AnyFn>().mockResolvedValue(merchantTransaction),
  });
  mock(getPaymentById).mockResolvedValue(payment);
  mock(getPaymentByEasyCreditRefundBookingId).mockResolvedValue(payment);
  mock(updatePayment).mockImplementation(async (current) => current);

  await handleEasyCreditNotification((merchantTransaction as { transactionId: string }).transactionId);
};

const stateChanges = () =>
  mock(updatePayment)
    .mock.calls.flatMap((call) => call[1] as { action: string; transactionId: string; state: string }[])
    .filter(({ action }) => action === 'changeTransactionState')
    .map(({ transactionId, state }) => [transactionId, state]);

describe('easyCredit notification for bill payment (sandbox payloads)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('captured, then refunded three times', () => {
    const payment = buildPayment('payment-bill-1', 'VFQ2XI', [
      { id: 'charge-1', type: 'Charge', state: 'Pending', interactionId: 'VFQ2XI' },
      { id: 'refund-100', type: 'Refund', state: 'Pending' },
      { id: 'refund-50', type: 'Refund', state: 'Initial' },
      { id: 'refund-450', type: 'Refund', state: 'Pending' },
    ]);

    it('TEBA-218: sets the pending Charge to Success for the DONE capture booking', async () => {
      await notifyWith(capturedAndRefunded, payment);

      expect(stateChanges()).toContainEqual(['charge-1', 'Success']);
    });

    it('TEBA-222: completes each partial refund by its own booking ID, also one left Initial', async () => {
      await notifyWith(capturedAndRefunded, payment);

      expect(stateChanges()).toEqual(
        expect.arrayContaining([
          ['refund-100', 'Success'],
          ['refund-50', 'Success'],
        ]),
      );
    });

    it('TEBA-223: fails the refund above the remaining amount and logs the easyCredit reason', async () => {
      await notifyWith(capturedAndRefunded, payment);

      expect(stateChanges()).toContainEqual(['refund-450', 'Failure']);
      expect(log.warn).toHaveBeenCalledWith(
        'EasyCredit refund failed, CommerceTools transaction state updated to Failure.',
        {
          paymentId: 'payment-bill-1',
          transactionId: 'refund-450',
          reason: 'The Refund amount is too high for this transaction.',
        },
      );
    });

    it('reads the payment for the capture only after the refunds were written', async () => {
      await notifyWith(capturedAndRefunded, payment);

      const refundWrite = mock(updatePayment).mock.invocationCallOrder[0];
      expect(mock(getPaymentById).mock.invocationCallOrder[0]).toBeGreaterThan(refundWrite);
    });

    it('ignores the NOTIFY bookings', async () => {
      await notifyWith(capturedAndRefunded, payment);

      expect(stateChanges()).toHaveLength(4);
    });
  });

  describe('refunded before the capture, then captured', () => {
    const payment = buildPayment('payment-bill-2', 'VFQ2FV', [
      { id: 'refund-before-capture', type: 'Refund', state: 'Pending' },
      { id: 'charge-1', type: 'Charge', state: 'Pending', interactionId: 'VFQ2FV' },
    ]);

    it('TEBA-222: completes the refund and the capture', async () => {
      await notifyWith(refundedBeforeCapture, payment);

      expect(stateChanges()).toEqual(
        expect.arrayContaining([
          ['refund-before-capture', 'Success'],
          ['charge-1', 'Success'],
        ]),
      );
    });
  });
});
