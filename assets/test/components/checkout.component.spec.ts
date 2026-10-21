/* eslint-disable no-global-assign */
import { ECCheckoutComponent, ECCheckoutComponentBuilder } from '../../src/components/checkout.component';
import { CheckoutComponentOptions, WebComponentOptions } from '../../src/types/main';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { findElement, importEasyCreditScript } from '../../src/utils/app.utils';

// Mock the imported utility functions
jest.mock('../../src/utils/app.utils');

// @ts-expect-error: Mock fetch globally
fetch = jest.fn() as jest.Mock;

const billAvailableResponse = (amount = 100) => ({
  webShopId: 'shop-id',
  amount,
  paymentTypes: { BILL_PAYMENT: { available: true } },
});

describe('ECCheckoutComponentBuilder', () => {
  let baseOptions: WebComponentOptions;

  beforeEach(() => {
    baseOptions = {
      processorUrl: 'https://example.com',
      sessionId: 'session-id',
    };
  });

  it('should create an ECCheckoutComponent with the correct options', () => {
    const builder = new ECCheckoutComponentBuilder(baseOptions);
    const checkoutComponentOptions: CheckoutComponentOptions = {
      cartId: 'cart-id',
      redirectLinks: {
        urlSuccess: '',
        urlCancellation: '',
        urlDenial: '',
      },
      customerRelationship: {
        customerStatus: 'NEW_CUSTOMER',
        customerSince: '',
        numberOfOrders: 0,
      },
      onLoading: jest.fn(),
      onSuccess: jest.fn(),
      onError: jest.fn(),
    };

    const component = builder.build(checkoutComponentOptions);

    expect(component).toBeInstanceOf(ECCheckoutComponent);
    expect(component['checkoutComponentOptions']).toEqual(checkoutComponentOptions); // Accessing private member for testing
  });
});

describe('ECCheckoutComponent', () => {
  let component: ECCheckoutComponent;
  let baseOptions: WebComponentOptions;
  let checkoutOptions: CheckoutComponentOptions;

  beforeEach(() => {
    baseOptions = {
      processorUrl: 'https://example.com',
      sessionId: 'session-id',
    };

    checkoutOptions = {
      cartId: 'cart-id',
      redirectLinks: {
        urlSuccess: '',
        urlCancellation: '',
        urlDenial: '',
      },
      customerRelationship: {
        customerStatus: 'NEW_CUSTOMER',
        customerSince: '',
        numberOfOrders: 0,
      },
      onError: jest.fn(),
      onSuccess: jest.fn(),
      onLoading: jest.fn(),
    };

    component = new ECCheckoutComponent({
      processorUrl: baseOptions.processorUrl,
      sessionId: baseOptions.sessionId,
      checkoutComponentOptions: checkoutOptions,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should mount the component and add HTML template to the DOM', async () => {
    const mockWidget = document.createElement('div');
    document.body.appendChild(mockWidget);

    const mockResponse = { webShopId: 'shop-id', amount: 100 };
    (fetch as jest.Mock).mockImplementation(async () =>
      Promise.resolve({
        ok: true,
        // @ts-expect-error test
        json: jest.fn().mockResolvedValueOnce(mockResponse),
      }),
    );
    (importEasyCreditScript as jest.Mock).mockImplementation(() => {});
    (findElement as jest.Mock).mockReturnValue({
      insertAdjacentHTML: jest.fn().mockImplementation(() => {
        mockWidget.innerHTML = 'easycredit-checkout';
      }),
      querySelector: jest.fn().mockReturnValue(null),
    });

    const selector = 'div'; // Select the newly created div
    await component.mount(selector);

    expect(importEasyCreditScript).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      `${baseOptions.processorUrl}/payments/payment-method/${checkoutOptions.cartId}?paymentType=INSTALLMENT_PAYMENT`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': baseOptions.sessionId,
        },
      },
    );

    expect(mockWidget.innerHTML).toContain('easycredit-checkout'); // Check if the template is inserted
  });

  it('should render the alert if easyCredit is unavailable', async () => {
    const insertAdjacentHTML = jest.fn();
    (fetch as jest.Mock).mockImplementation(async () =>
      Promise.resolve({
        ok: false,
        // @ts-expect-error test
        json: jest.fn().mockResolvedValueOnce({
          message: 'easyCredit ist derzeit nicht erreichbar. Bitte versuchen Sie es später erneut.',
          statusCode: 503,
          errors: [
            {
              code: 'EasyCreditUnavailable',
              message: 'easyCredit ist derzeit nicht erreichbar. Bitte versuchen Sie es später erneut.',
              fields: { webShopId: 'shop-id' },
            },
          ],
        }),
      }),
    );
    (findElement as jest.Mock).mockReturnValue({ insertAdjacentHTML, querySelector: jest.fn().mockReturnValue(null) });

    await component.mount('div');

    const template = insertAdjacentHTML.mock.calls[0][1] as string;
    expect(template).toContain('webshop-id="shop-id"');
    expect(template).toContain(
      'alert="easyCredit ist derzeit nicht erreichbar. Bitte versuchen Sie es später erneut."',
    );
  });

  it('should handle errors during payment method retrieval', async () => {
    (fetch as jest.Mock).mockImplementation(async () =>
      Promise.resolve({
        ok: false,
        // @ts-expect-error test
        json: jest.fn().mockResolvedValueOnce({ errors: [] }),
      }),
    );

    await expect(component.mount('div')).rejects.toThrow('Invalid WebShopId received.');
  });

  it('should submit the payment successfully', async () => {
    (fetch as jest.Mock).mockImplementation(async () =>
      Promise.resolve({
        ok: true,
        // @ts-expect-error test
        json: jest.fn().mockResolvedValueOnce({ redirectUrl: 'https://redirect.com' }),
      }),
    );

    await component.submit();

    expect(fetch).toHaveBeenCalledWith(`${baseOptions.processorUrl}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': baseOptions.sessionId,
      },
      body: JSON.stringify({
        cartId: checkoutOptions.cartId,
        paymentType: 'INSTALLMENT_PAYMENT',
        redirectLinks: checkoutOptions.redirectLinks,
        customerRelationship: checkoutOptions.customerRelationship,
      }),
    });
    expect(checkoutOptions.onLoading).toHaveBeenCalledTimes(1);
    expect(checkoutOptions.onError).toHaveBeenCalledTimes(0);
    expect(checkoutOptions.onSuccess).toHaveBeenCalledWith({ redirectUrl: 'https://redirect.com' });
  });

  describe('bill payment', () => {
    const mockPaymentMethodResponse = (body: unknown) =>
      (fetch as jest.Mock).mockImplementation(async () =>
        Promise.resolve({
          ok: true,
          // @ts-expect-error test
          json: jest.fn().mockResolvedValue(body),
        }),
      );
    const unavailableResponse = (code: string) => ({
      statusCode: 400,
      message: 'error',
      errors: [{ code, message: 'error', fields: { webShopId: 'shop-id' } }],
    });

    let element: { insertAdjacentHTML: jest.Mock; querySelector: jest.Mock };

    beforeEach(() => {
      component = new ECCheckoutComponent({
        processorUrl: baseOptions.processorUrl,
        sessionId: baseOptions.sessionId,
        checkoutComponentOptions: { ...checkoutOptions, paymentType: 'BILL_PAYMENT' },
      });
      element = { insertAdjacentHTML: jest.fn(), querySelector: jest.fn().mockReturnValue(null) };
      (findElement as jest.Mock).mockReturnValue(element);
    });

    it('should render the bill payment widget', async () => {
      mockPaymentMethodResponse(billAvailableResponse());

      await component.mount('div');

      expect(fetch).toHaveBeenCalledWith(
        `${baseOptions.processorUrl}/payments/payment-method/${checkoutOptions.cartId}?paymentType=BILL_PAYMENT`,
        expect.anything(),
      );
      expect(element.insertAdjacentHTML).toHaveBeenCalledWith(
        'beforeend',
        expect.stringContaining('payment-type="BILL"'),
      );
    });

    it('should bind the submit handler to its own widget', async () => {
      const widget = { addEventListener: jest.fn() };
      element.querySelector.mockReturnValue(widget);
      mockPaymentMethodResponse(billAvailableResponse());

      await component.mount('div');

      expect(element.querySelector).toHaveBeenCalledWith('easycredit-checkout');
      expect(widget.addEventListener).toHaveBeenCalledWith('submit', expect.any(Function));
    });

    it.each(['PaymentTypeNotAvailable', 'InvalidAmount', 'EasyCreditUnavailable'])(
      'should be unavailable and render nothing on %s',
      async (code) => {
        mockPaymentMethodResponse(unavailableResponse(code));

        await expect(component.isAvailable()).resolves.toBe(false);
        await component.mount('div');

        expect(importEasyCreditScript).not.toHaveBeenCalled();
        expect(element.insertAdjacentHTML).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['an older processor that omits paymentTypes', { webShopId: 'shop-id', amount: 100 }],
      [
        'a response that reports bill payment unavailable',
        { webShopId: 'shop-id', amount: 100, paymentTypes: { BILL_PAYMENT: { available: false } } },
      ],
    ])('should be unavailable and render nothing on a 200 from %s', async (_, body) => {
      mockPaymentMethodResponse(body);

      await expect(component.isAvailable()).resolves.toBe(false);
      await component.mount('div');

      expect(importEasyCreditScript).not.toHaveBeenCalled();
      expect(element.insertAdjacentHTML).not.toHaveBeenCalled();
    });

    it('should submit the bill payment type', async () => {
      (fetch as jest.Mock).mockImplementation(async () =>
        Promise.resolve({
          ok: true,
          // @ts-expect-error test
          json: jest.fn().mockResolvedValueOnce({ redirectUrl: 'https://redirect.com' }),
        }),
      );

      await component.submit();

      const [, request] = (fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(request.body as string)).toMatchObject({ paymentType: 'BILL_PAYMENT' });
    });

    it('should stay available and show an alert for a corporate customer', async () => {
      mockPaymentMethodResponse({
        statusCode: 400,
        message: 'error',
        errors: [
          { code: 'CorporateCustomerNotAllowed', message: 'Nur für Privatpersonen', fields: { webShopId: 'shop-id' } },
        ],
      });

      await expect(component.isAvailable()).resolves.toBe(true);
      await component.mount('div');

      expect(element.insertAdjacentHTML).toHaveBeenCalledWith(
        'beforeend',
        expect.stringContaining('alert="Nur für Privatpersonen"'),
      );
    });
  });

  it('should keep showing the installment widget with an alert if the amount is out of limits', async () => {
    const element = { insertAdjacentHTML: jest.fn(), querySelector: jest.fn().mockReturnValue(null) };
    (findElement as jest.Mock).mockReturnValue(element);
    (fetch as jest.Mock).mockImplementation(async () =>
      Promise.resolve({
        ok: false,
        // @ts-expect-error test
        json: jest.fn().mockResolvedValue({
          statusCode: 400,
          message: 'error',
          errors: [{ code: 'InvalidAmount', message: 'Out of limits', fields: { webShopId: 'shop-id' } }],
        }),
      }),
    );

    await expect(component.isAvailable()).resolves.toBe(true);
    await component.mount('div');

    expect(element.insertAdjacentHTML).toHaveBeenCalledWith(
      'beforeend',
      expect.stringContaining('alert="Out of limits"'),
    );
  });

  describe('availability of responses the widget cannot be rendered from', () => {
    const respondWith = (body: unknown, ok = false) =>
      jest.mocked(fetch).mockResolvedValue({ ok, json: async () => body } as Response);
    const nonRenderableBodies: [string, unknown][] = [
      ['a 401 without errors', { statusCode: 401, message: 'Unauthorized' }],
      [
        'a 500 without webShopId',
        { statusCode: 500, message: 'Internal', errors: [{ code: 'General', message: 'Internal' }] },
      ],
      ['an empty success body', {}],
    ];

    let element: { insertAdjacentHTML: jest.Mock; querySelector: jest.Mock };

    beforeEach(() => {
      element = { insertAdjacentHTML: jest.fn(), querySelector: jest.fn().mockReturnValue(null) };
      (findElement as jest.Mock).mockReturnValue(element);
    });

    it.each(nonRenderableBodies)(
      'should report bill payment as unavailable and render nothing on %s',
      async (_, body) => {
        component = new ECCheckoutComponent({
          ...baseOptions,
          checkoutComponentOptions: { ...checkoutOptions, paymentType: 'BILL_PAYMENT' },
        });
        respondWith(body);

        await expect(component.isAvailable()).resolves.toBe(false);
        await expect(component.mount('div')).resolves.toBeUndefined();

        expect(element.insertAdjacentHTML).not.toHaveBeenCalled();
      },
    );

    it.each(nonRenderableBodies)('should report installment as unavailable on %s', async (_, body) => {
      respondWith(body);

      await expect(component.isAvailable()).resolves.toBe(false);
      await expect(component.mount('div')).rejects.toThrow('Invalid WebShopId received.');
    });

    it.each([
      ['a network error', () => jest.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))],
      [
        'a non-JSON body',
        () =>
          jest.mocked(fetch).mockResolvedValueOnce({
            ok: false,
            json: async () => {
              throw new SyntaxError('Unexpected token <');
            },
          } as unknown as Response),
      ],
    ])('should report bill payment as unavailable on %s and fetch again on mount', async (_, failRequest) => {
      component = new ECCheckoutComponent({
        ...baseOptions,
        checkoutComponentOptions: { ...checkoutOptions, paymentType: 'BILL_PAYMENT' },
      });
      failRequest();

      await expect(component.isAvailable()).resolves.toBe(false);

      respondWith(billAvailableResponse(), true);
      await component.mount('div');

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(element.insertAdjacentHTML).toHaveBeenCalledWith(
        'beforeend',
        expect.stringContaining('payment-type="BILL"'),
      );
    });
  });

  it('should hide installment on PaymentTypeNotAvailable but still render its widget with the alert', async () => {
    const element = { insertAdjacentHTML: jest.fn(), querySelector: jest.fn().mockReturnValue(null) };
    (findElement as jest.Mock).mockReturnValue(element);
    jest.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({
        statusCode: 400,
        message: 'error',
        errors: [{ code: 'PaymentTypeNotAvailable', message: 'Not available', fields: { webShopId: 'shop-id' } }],
      }),
    } as Response);

    await expect(component.isAvailable()).resolves.toBe(false);
    await component.mount('div');

    expect(importEasyCreditScript).toHaveBeenCalled();
    expect(element.insertAdjacentHTML).toHaveBeenCalledWith(
      'beforeend',
      expect.stringMatching(/payment-type="INSTALLMENT"[\s\S]*alert="Not available"/),
    );
  });

  it('should encode the cart id in the payment method request', async () => {
    component = new ECCheckoutComponent({
      ...baseOptions,
      checkoutComponentOptions: { ...checkoutOptions, cartId: 'a/b?c' },
    });
    jest.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ webShopId: 'shop-id' }) } as Response);

    await component.isAvailable();

    expect(fetch).toHaveBeenCalledWith(
      `${baseOptions.processorUrl}/payments/payment-method/a%2Fb%3Fc?paymentType=INSTALLMENT_PAYMENT`,
      expect.anything(),
    );
  });

  it.each(['INSTALLMENT', 'bill_payment', null])('should reject the unknown payment type %p', (paymentType) => {
    expect(() =>
      new ECCheckoutComponentBuilder(baseOptions).build({
        ...checkoutOptions,
        paymentType: paymentType as unknown as CheckoutComponentOptions['paymentType'],
      }),
    ).toThrow(`Invalid easyCredit paymentType "${String(paymentType)}"`);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('should call onError callback when the submission fails', async () => {
    const errorResponse = { error: 'Payment failed' };
    (fetch as jest.Mock).mockImplementation(async () =>
      Promise.resolve({
        ok: false,
        // @ts-expect-error test
        json: jest.fn().mockResolvedValueOnce(errorResponse),
      }),
    );

    await component.submit();

    expect(checkoutOptions.onLoading).toHaveBeenCalledTimes(1);
    expect(checkoutOptions.onError).toHaveBeenCalledWith(errorResponse);
    expect(checkoutOptions.onSuccess).toHaveBeenCalledTimes(0);
  });

  describe('refreshing payment method data', () => {
    const actualUtils = jest.requireActual<typeof import('../../src/utils/app.utils')>('../../src/utils/app.utils');

    const respondWith = (body: unknown, ok = true) => {
      jest.mocked(fetch).mockResolvedValue({ ok, json: async () => body } as Response);
    };

    beforeEach(() => {
      document.body.innerHTML = '<div id="checkout"></div>';
      jest.mocked(findElement).mockImplementation(actualUtils.findElement);
    });

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('should replace a stale address alert with the current amount when remounted', async () => {
      respondWith(
        {
          statusCode: 400,
          message: 'Invalid cart',
          errors: [{ code: 'AddressesUnmatched', message: 'Addresses differ', fields: { webShopId: 'shop-id' } }],
        },
        false,
      );
      await component.mount('#checkout');
      expect(document.querySelector('easycredit-checkout')?.getAttribute('alert')).toBe('Addresses differ');

      respondWith({ webShopId: 'shop-id', amount: 500 });
      document.querySelector('#checkout')!.innerHTML = '';
      await component.mount('#checkout');

      const widget = document.querySelector('easycredit-checkout');
      expect(widget?.getAttribute('alert')).toBe('');
      expect(widget?.getAttribute('amount')).toBe('500');
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should read the current cart on every availability check and mount', async () => {
      respondWith({ webShopId: 'shop-id', amount: 500 });
      await expect(component.isAvailable()).resolves.toBe(true);

      respondWith({ webShopId: 'shop-id', amount: 700 });
      await component.mount('#checkout');

      expect(document.querySelector('easycredit-checkout')?.getAttribute('amount')).toBe('700');
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it.each(['InvalidAmount', 'EasyCreditUnavailable'])(
      'should offer bill payment again after %s is resolved',
      async (code) => {
        component = new ECCheckoutComponent({
          ...baseOptions,
          checkoutComponentOptions: { ...checkoutOptions, paymentType: 'BILL_PAYMENT' },
        });
        respondWith(
          {
            statusCode: code === 'EasyCreditUnavailable' ? 503 : 400,
            message: 'Unavailable',
            errors: [{ code, message: 'Unavailable', fields: { webShopId: 'shop-id' } }],
          },
          false,
        );
        await expect(component.isAvailable()).resolves.toBe(false);

        respondWith(billAvailableResponse(500));
        await expect(component.isAvailable()).resolves.toBe(true);
        await component.mount('#checkout');

        expect(document.querySelector('easycredit-checkout')?.getAttribute('payment-type')).toBe('BILL');
        expect(fetch).toHaveBeenCalledTimes(3);
      },
    );
  });
});
