import { describe, expect, test } from '@jest/globals';
import {
  EASYCREDIT_BASE_API_URL,
  EASYCREDIT_PARTNER_BASE_API_URL,
  EASYCREDIT_REFUND_BOOKING_TYPE,
  EASYCREDIT_REFUND_STATUS_DONE,
  EASYCREDIT_REFUND_STATUS_FAILED,
  getPaymentCustomTypeKey,
  LIBRARY_NAME,
  LIBRARY_VERSION,
  VERSION_STRING,
} from '../../src/utils/constant.utils';
import { version } from '../../package.json';

describe('Test constant.utils.ts', () => {
  test('should return the correct {EASYCREDIT_BASE_API_URL} constant', () => {
    expect(EASYCREDIT_BASE_API_URL).toBeDefined();
    expect(EASYCREDIT_BASE_API_URL).toBe('https://ratenkauf.easycredit.de/api');
  });

  test('should return the correct {EASYCREDIT_PARTNER_BASE_API_URL} constant', () => {
    expect(EASYCREDIT_PARTNER_BASE_API_URL).toBeDefined();
    expect(EASYCREDIT_PARTNER_BASE_API_URL).toBe('https://partner.easycredit-ratenkauf.de/api');
  });

  test('should return the correct {LIBRARY_NAME} constant', () => {
    expect(LIBRARY_NAME).toBeDefined();
    expect(LIBRARY_NAME).toBe('ShopmacherCommercetoolsEasyCreditConnector');
  });

  test('should return the correct {LIBRARY_VERSION} constant', () => {
    expect(LIBRARY_VERSION).toBeDefined();
    expect(LIBRARY_VERSION).toBe(version);
  });

  test('should return the correct {VERSION_STRING} constant', () => {
    expect(VERSION_STRING).toBeDefined();
    expect(VERSION_STRING).toBe(`${LIBRARY_NAME}/${LIBRARY_VERSION}`);
  });

  test('should return the correct {EASYCREDIT_REFUND_BOOKING_TYPE} constant', () => {
    expect(EASYCREDIT_REFUND_BOOKING_TYPE).toBeDefined();
    expect(EASYCREDIT_REFUND_BOOKING_TYPE).toBe('RefundBooking');
  });

  test('should return the correct {EASYCREDIT_REFUND_STATUS_DONE} constant', () => {
    expect(EASYCREDIT_REFUND_STATUS_DONE).toBeDefined();
    expect(EASYCREDIT_REFUND_STATUS_DONE).toBe('DONE');
  });

  test('should return the correct {EASYCREDIT_REFUND_STATUS_FAILED} constant', () => {
    expect(EASYCREDIT_REFUND_STATUS_FAILED).toBeDefined();
    expect(EASYCREDIT_REFUND_STATUS_FAILED).toBe('FAILED');
  });

  test('should default the payment custom type key and let the env override it', () => {
    const original = process.env.PAYMENT_CUSTOM_TYPE_KEY;

    try {
      delete process.env.PAYMENT_CUSTOM_TYPE_KEY;
      expect(getPaymentCustomTypeKey()).toBe('easy-credit-payment');

      process.env.PAYMENT_CUSTOM_TYPE_KEY = 'shared-payment-type';
      expect(getPaymentCustomTypeKey()).toBe('shared-payment-type');
    } finally {
      if (original === undefined) {
        delete process.env.PAYMENT_CUSTOM_TYPE_KEY;
      } else {
        process.env.PAYMENT_CUSTOM_TYPE_KEY = original;
      }
    }
  });
});
