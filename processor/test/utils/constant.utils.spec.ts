import { describe, test, expect } from '@jest/globals';
import {
  EASYCREDIT_BASE_API_URL,
  EASYCREDIT_PARTNER_BASE_API_URL,
  EASYCREDIT_REFUND_BOOKING_TYPE,
  EASYCREDIT_REFUND_STATUS_DONE,
  EASYCREDIT_REFUND_STATUS_FAILED,
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
});
