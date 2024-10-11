/**
 * @jest-environment jsdom
 */

import {
  EasyCreditCheckout,
  EasyCreditCheckoutBuilder,
} from '../../../src/components/payment-methods/easycredit/easycredit';
import { BaseOptions } from '../../../src/payment-enabler/payment-enabler-mock';
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

describe('test EasyCreditCheckoutBuilder', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  jest.spyOn(require('node-fetch'), 'fetch');

  let mockBaseOptions: BaseOptions;

  beforeEach(() => {
    mockBaseOptions = {
      sessionId: '',
      environment: '',
      locale: '',
      showPayButton: true,
      onDropinReady: jest.fn<() => Promise<void>>(() => Promise.resolve()),
      onPayButtonClick: jest.fn<() => Promise<void>>(() => Promise.resolve()),
      processorUrl: 'https://test-processor-url.com',
      amount: 100,
      onComplete: jest.fn(),
      onError: jest.fn(),
    };
  });

  test('should configure options correctly and return a EasyCreditCheckout instance', () => {
    const builder = new EasyCreditCheckoutBuilder(mockBaseOptions);
    const component = builder.build();

    expect(component).toBeInstanceOf(EasyCreditCheckout);

    const easyCreditCheckout = component as EasyCreditCheckout;
    expect(easyCreditCheckout.baseOptions).toEqual(mockBaseOptions);
  });
});

describe('test EasyCreditCheckout', () => {
  let mockBaseOptions: BaseOptions;
  let component: EasyCreditCheckout;

  beforeEach(() => {
    mockBaseOptions = {
      sessionId: '',
      environment: '',
      locale: '',
      showPayButton: true,
      onDropinReady: jest.fn<() => Promise<void>>(() => Promise.resolve()),
      onPayButtonClick: jest.fn<() => Promise<void>>(() => Promise.resolve()),
      processorUrl: 'https://test-processor-url.com',
      amount: 100,
      onComplete: jest.fn(),
      onError: jest.fn(),
    };

    component = new EasyCreditCheckout(mockBaseOptions);
  });

  test('should insert the widget template when mounting and widget is enabled', async () => {
    const mockConfig = { webShopId: '123' };
    jest.spyOn(component, 'getPaymentMethod').mockResolvedValue(mockConfig);

    document.body.innerHTML = '<div id="widget"></div>';

    await component.mount('#widget');

    expect(document.querySelector('#widget')?.innerHTML).toContain(
      `<easycredit-checkout amount="${component.baseOptions.amount}" webshop-id="${mockConfig.webShopId}" is-active="true" payment-type="INSTALLMENT" alert=""></easycredit-checkout>`,
    );
  });

  test('should not render the component if the webShopId is invalid', async () => {
    const mockConfig = { webShopId: null };
    jest.spyOn(component, 'getPaymentMethod').mockResolvedValue(mockConfig);
    document.body.innerHTML = '<div id="widget"></div>';

    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    await component.mount('#widget');

    expect(document.querySelector('#widget')?.innerHTML).toBe('');

    expect(consoleError).toBeCalledTimes(1);
    expect(consoleError).toBeCalledWith(new Error('Invalid WebShopId'));
  });

  test('should display correct error messages', async () => {
    const mockConfig = {
      errors: [
        {
          code: 'AddressesUnmatched',
          message: 'Liefer- und Rechnungsadresse sind identisch und in Deutschland.',
          webShopId: '123',
        },
        {
          code: 'InvalidAmount',
          message: `Summe des Warenkorbs beträgt zwischen 200€ und 10000€.`,
          webShopId: '123',
        },
      ],
    };
    jest.spyOn(component, 'getPaymentMethod').mockResolvedValue(mockConfig);

    document.body.innerHTML = '<div id="widget"></div>';

    const errorMessage = mockConfig.errors[0].message + ' ' + mockConfig.errors[1].message;

    await component.mount('#widget');

    expect(document.querySelector('#widget')?.innerHTML).toContain(
      `<easycredit-checkout amount="${component.baseOptions.amount}" webshop-id="${mockConfig.errors[0].webShopId}" is-active="true" payment-type="INSTALLMENT" alert="${errorMessage}"></easycredit-checkout>`,
    );
  });

  test('should able to log the error to console whenever an unexpected error occurs', async () => {
    const error = new Error('dummy error');

    jest.spyOn(component, 'getPaymentMethod').mockImplementation(() => {
      throw error;
    });
    document.body.innerHTML = '<div id="widget"></div>';

    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    await component.mount('#widget');

    expect(consoleError).toBeCalledTimes(1);
    expect(consoleError).toBeCalledWith('Failed to get EasyCredit payment method', error);
  });

  test('able to call submit()', () => {
    expect(component.submit()).toBe(undefined);
  });

  // @ts-expect-error: Mock fetch globally
  // eslint-disable-next-line no-global-assign
  fetch = jest.fn() as jest.Mock;

  test('able to call getPaymentMethod()', async () => {
    (fetch as unknown as jest.Mock).mockImplementation(async () =>
      Promise.resolve({
        json: () => Promise.resolve({ data: [] }),
        headers: new Headers(),
        ok: true,
        redirected: false,
        status: 201,
        statusText: 'OK',
        url: '',
      }),
    );

    await component.getPaymentMethod();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      `${component.baseOptions.processorUrl}/payments/payment-method?cartId=${component.baseOptions.cartId}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': component.baseOptions.sessionId },
      },
    );
  });
});
