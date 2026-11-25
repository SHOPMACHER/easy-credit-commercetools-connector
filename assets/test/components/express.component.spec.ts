/* eslint-disable no-global-assign */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ECExpressButtonComponent, ECExpressButtonComponentBuilder } from '../../src/components/express.component';
import { ExpressButtonComponentOptions } from '../../src/types/main';
import { importEasyCreditScript } from '../../src/utils/app.utils';

// Keep the real findElement: the submit event is dispatched on the rendered element.
jest.mock('../../src/utils/app.utils', () => ({
  ...(jest.requireActual('../../src/utils/app.utils') as object),
  importEasyCreditScript: jest.fn(),
}));

// @ts-expect-error: Mock fetch globally
fetch = jest.fn() as jest.Mock;

const baseOptions = { processorUrl: 'https://processor.example.com', sessionId: 'built-session' };

const redirectLinks = {
  urlSuccess: 'https://shop.example.com/express/return',
  urlCancellation: 'https://shop.example.com/cart',
  urlDenial: 'https://shop.example.com/cart',
};

const widgetEnabled = (overrides: Record<string, unknown> = {}) => ({
  // The express button ignores the widget switch.
  isEnabled: false,
  webShopId: 'shop-id',
  paymentTypes: ['INSTALLMENT_PAYMENT', 'BILL_PAYMENT'],
  expressButtonEnabled: true,
  expressButtonVisibility: 'PDP_AND_CART',
  ...overrides,
});

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const nonJsonResponse = (status: number) => ({
  ok: false,
  status,
  json: async () => {
    throw new SyntaxError('Unexpected token <');
  },
});

const mockFetch = (routes: (url: string) => unknown) =>
  (fetch as jest.Mock).mockImplementation(async (url) => routes(url as string));

const fetchedUrls = () => (fetch as jest.Mock).mock.calls.map(([url]) => url as string);

const renderedButton = () => document.querySelector('#express easycredit-express-button');

const createComponent = (options: Partial<ExpressButtonComponentOptions> = {}) =>
  new ECExpressButtonComponentBuilder(baseOptions).build({
    placement: 'PDP',
    amount: 299.9,
    redirectLinks,
    onError: jest.fn(),
    onSuccess: jest.fn(),
    ...options,
  });

describe('ECExpressButtonComponentBuilder', () => {
  it('builds an ECExpressButtonComponent', () => {
    expect(createComponent()).toBeInstanceOf(ECExpressButtonComponent);
  });
});

describe('ECExpressButtonComponent', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="express"></div>';
    jest.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('mount', () => {
    it('renders nothing when expressButtonEnabled is false', async () => {
      mockFetch(() => jsonResponse(200, widgetEnabled({ isEnabled: true, expressButtonEnabled: false })));

      await expect(createComponent().mount('#express')).resolves.toBe(false);

      expect(renderedButton()).toBeNull();
      expect(importEasyCreditScript).not.toHaveBeenCalled();
    });

    it('renders nothing for an old processor without expressButtonEnabled', async () => {
      mockFetch(() =>
        jsonResponse(200, { isEnabled: true, webShopId: 'shop-id', paymentTypes: ['INSTALLMENT_PAYMENT'] }),
      );

      await expect(createComponent().mount('#express')).resolves.toBe(false);

      expect(renderedButton()).toBeNull();
    });

    it.each([
      ['PDP', 'CART'],
      ['CART', 'PDP'],
      ['PDP', undefined],
      ['PDP', 'PDP_CART'],
    ] as const)('renders nothing on %s when visibility is %s', async (placement, expressButtonVisibility) => {
      mockFetch(() => jsonResponse(200, widgetEnabled({ expressButtonVisibility })));

      await expect(createComponent({ placement }).mount('#express')).resolves.toBe(false);

      expect(renderedButton()).toBeNull();
    });

    it.each(['PDP', 'CART'] as const)('renders on %s when visibility equals the placement', async (placement) => {
      mockFetch(() => jsonResponse(200, widgetEnabled({ expressButtonVisibility: placement })));

      await expect(createComponent({ placement }).mount('#express')).resolves.toBe(true);
    });

    it('renders on PDP with the types from widget-enabled', async () => {
      mockFetch(() => jsonResponse(200, widgetEnabled()));

      await expect(createComponent().mount('#express')).resolves.toBe(true);

      const button = renderedButton();
      expect(button?.getAttribute('webshop-id')).toBe('shop-id');
      expect(button?.getAttribute('amount')).toBe('299.9');
      expect(button?.getAttribute('payment-types')).toBe('INSTALLMENT,BILL');
      // With redirect-url set, the web component opens an iframe and never fires easycredit-submit.
      expect(button?.hasAttribute('redirect-url')).toBe(false);
      expect(importEasyCreditScript).toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledWith(`${baseOptions.processorUrl}/operations/widget-enabled`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': 'built-session' },
      });
      expect(fetchedUrls().some((url) => url.includes('/payments/express/payment-method'))).toBe(false);
    });

    it('renders nothing when widget-enabled offers no payment type', async () => {
      mockFetch(() => jsonResponse(200, widgetEnabled({ paymentTypes: [] })));

      await expect(createComponent().mount('#express')).resolves.toBe(false);

      expect(renderedButton()).toBeNull();
    });

    it('resolves false when widget-enabled fails', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      (fetch as jest.Mock).mockImplementation(async () => {
        throw new Error('Failed to fetch');
      });

      await expect(createComponent().mount('#express')).resolves.toBe(false);

      consoleSpy.mockRestore();
    });

    it('on CART keeps only types the express payment-method check allows', async () => {
      mockFetch((url) => {
        if (url.endsWith('/operations/widget-enabled')) return jsonResponse(200, widgetEnabled());
        if (url.endsWith('paymentType=INSTALLMENT_PAYMENT')) return jsonResponse(200, { webShopId: 'shop-id' });
        return jsonResponse(400, { statusCode: 400, errors: [{ code: 'PaymentTypeNotAvailable' }] });
      });

      await expect(createComponent({ placement: 'CART' }).mount('#express')).resolves.toBe(true);

      expect(renderedButton()?.getAttribute('payment-types')).toBe('INSTALLMENT');
      expect(fetch).toHaveBeenCalledWith(
        `${baseOptions.processorUrl}/payments/express/payment-method?paymentType=BILL_PAYMENT`,
        { method: 'GET', headers: { 'Content-Type': 'application/json', 'X-Session-Id': 'built-session' } },
      );
    });

    it('on CART hides a type on any error', async () => {
      mockFetch((url) => {
        if (url.endsWith('/operations/widget-enabled')) return jsonResponse(200, widgetEnabled());
        if (url.endsWith('paymentType=INSTALLMENT_PAYMENT'))
          return jsonResponse(400, { statusCode: 400, errors: [{ code: 'InvalidAmount' }] });
        return jsonResponse(200, { webShopId: 'shop-id' });
      });

      await expect(createComponent({ placement: 'CART' }).mount('#express')).resolves.toBe(true);

      expect(renderedButton()?.getAttribute('payment-types')).toBe('BILL');
    });

    it('resolves false when the selector matches no element', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch(() => jsonResponse(200, widgetEnabled()));

      await expect(createComponent().mount('#missing')).resolves.toBe(false);

      expect(document.querySelector('easycredit-express-button')).toBeNull();
      consoleSpy.mockRestore();
    });

    it.each([NaN, Infinity, undefined])('renders nothing when amount is %s', async (amount) => {
      mockFetch(() => jsonResponse(200, widgetEnabled()));

      await expect(createComponent({ amount: amount as number }).mount('#express')).resolves.toBe(false);

      expect(renderedButton()).toBeNull();
    });

    it('keeps the button of the latest mount when an earlier mount finishes last', async () => {
      const pending: ((value: unknown) => void)[] = [];
      (fetch as jest.Mock).mockImplementation(() => new Promise((resolve) => pending.push(resolve)));

      const mountA = createComponent({ amount: 100 }).mount('#express');
      const mountB = createComponent({ amount: 200 }).mount('#express');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(pending).toHaveLength(2);

      pending[1](jsonResponse(200, widgetEnabled()));
      await expect(mountB).resolves.toBe(true);
      pending[0](jsonResponse(200, widgetEnabled()));
      await expect(mountA).resolves.toBe(false);

      const buttons = document.querySelectorAll('#express easycredit-express-button');
      expect(buttons).toHaveLength(1);
      expect(buttons[0].getAttribute('amount')).toBe('200');
    });

    it.each([
      ['express is switched off', widgetEnabled({ expressButtonEnabled: false })],
      ['visibility excludes the placement', widgetEnabled({ expressButtonVisibility: 'CART' })],
      ['no payment type is allowed', widgetEnabled({ paymentTypes: [] })],
    ])('removes an earlier button when a later mount renders nothing because %s', async (_, config) => {
      mockFetch(() => jsonResponse(200, widgetEnabled()));
      await expect(createComponent().mount('#express')).resolves.toBe(true);

      mockFetch(() => jsonResponse(200, config));
      await expect(createComponent().mount('#express')).resolves.toBe(false);

      expect(renderedButton()).toBeNull();
    });

    it('removes an earlier button when a later mount fails', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch(() => jsonResponse(200, widgetEnabled()));
      await expect(createComponent().mount('#express')).resolves.toBe(true);

      (fetch as jest.Mock).mockImplementation(async () => {
        throw new Error('Failed to fetch');
      });
      await expect(createComponent().mount('#express')).resolves.toBe(false);

      expect(renderedButton()).toBeNull();
      consoleSpy.mockRestore();
    });

    it('removes an earlier button when a later mount has no finite amount', async () => {
      mockFetch(() => jsonResponse(200, widgetEnabled()));
      await expect(createComponent().mount('#express')).resolves.toBe(true);

      await expect(createComponent({ amount: NaN }).mount('#express')).resolves.toBe(false);

      expect(renderedButton()).toBeNull();
    });

    it.each([
      ['a network error', () => Promise.reject(new Error('Failed to fetch'))],
      ['a non-JSON body', () => nonJsonResponse(502)],
    ])('on CART renders nothing on %s for both types', async (_, paymentMethodResponse) => {
      mockFetch((url) =>
        url.endsWith('/operations/widget-enabled') ? jsonResponse(200, widgetEnabled()) : paymentMethodResponse(),
      );

      await expect(createComponent({ placement: 'CART' }).mount('#express')).resolves.toBe(false);

      expect(renderedButton()).toBeNull();
    });
  });

  describe('submit', () => {
    const mountAndSubmit = async (options: Partial<ExpressButtonComponentOptions>, paymentType = 'BILL') => {
      const component = createComponent(options);
      await component.mount('#express');
      renderedButton()?.dispatchEvent(
        new CustomEvent('easycredit-submit', { bubbles: true, composed: true, detail: { paymentType } }),
      );
      // Let the async submit handler settle.
      await new Promise((resolve) => setTimeout(resolve, 0));
    };

    const createdPayment = { paymentId: 'payment-id', redirectUrl: 'https://easycredit.example.com' };

    it('posts the express payment on easycredit-submit', async () => {
      const onSuccess = jest.fn();
      const onLoading = jest.fn();
      mockFetch((url) =>
        url.endsWith('/payments/express') ? jsonResponse(201, createdPayment) : jsonResponse(200, widgetEnabled()),
      );

      await mountAndSubmit({ onSuccess, onLoading });

      expect(onLoading).toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledWith(`${baseOptions.processorUrl}/payments/express`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': 'built-session' },
        body: JSON.stringify({ paymentType: 'BILL_PAYMENT', redirectLinks }),
      });
      expect(onSuccess).toHaveBeenCalledWith(createdPayment);
    });

    it('replaces the button on a second mount and posts once per click', async () => {
      mockFetch((url) =>
        url.endsWith('/payments/express') ? jsonResponse(201, createdPayment) : jsonResponse(200, widgetEnabled()),
      );
      const component = createComponent();

      await component.mount('#express');
      await expect(component.mount('#express')).resolves.toBe(true);

      const buttons = document.querySelectorAll('#express easycredit-express-button');
      expect(buttons).toHaveLength(1);

      buttons[0].dispatchEvent(new CustomEvent('easycredit-submit', { detail: { paymentType: 'BILL' } }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(fetchedUrls().filter((url) => url.endsWith('/payments/express'))).toHaveLength(1);
    });

    it('does not post again while a submit is still running', async () => {
      let resolvePost: (value: unknown) => void = () => {};
      const onSuccess = jest.fn();
      mockFetch((url) =>
        url.endsWith('/payments/express')
          ? new Promise((resolve) => (resolvePost = resolve))
          : jsonResponse(200, widgetEnabled()),
      );
      await createComponent({ onSuccess }).mount('#express');
      const click = () =>
        renderedButton()?.dispatchEvent(new CustomEvent('easycredit-submit', { detail: { paymentType: 'BILL' } }));

      click();
      click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(fetchedUrls().filter((url) => url.endsWith('/payments/express'))).toHaveLength(1);

      resolvePost(jsonResponse(201, createdPayment));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onSuccess).toHaveBeenCalledTimes(1);

      // A finished submit (e.g. after an error the shopper retries) can post again.
      click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(fetchedUrls().filter((url) => url.endsWith('/payments/express'))).toHaveLength(2);
    });

    it('ignores the deprecated submit event', async () => {
      mockFetch(() => jsonResponse(200, widgetEnabled()));
      await createComponent().mount('#express');

      renderedButton()?.dispatchEvent(
        new CustomEvent('submit', { bubbles: true, composed: true, detail: { paymentType: 'BILL' } }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(fetchedUrls().some((url) => url.endsWith('/payments/express'))).toBe(false);
    });

    it('uses the session id returned by prepareCart', async () => {
      const calls: string[] = [];
      const prepareCart = jest.fn(async () => {
        calls.push('prepareCart');
        return 'new-session';
      });
      mockFetch((url) => {
        if (url.endsWith('/payments/express')) {
          calls.push('post');
          return jsonResponse(201, createdPayment);
        }
        return jsonResponse(200, widgetEnabled());
      });

      await mountAndSubmit({ prepareCart }, 'INSTALLMENT');

      expect(calls).toEqual(['prepareCart', 'post']);
      expect(fetch).toHaveBeenCalledWith(`${baseOptions.processorUrl}/payments/express`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': 'new-session' },
        body: JSON.stringify({ paymentType: 'INSTALLMENT_PAYMENT', redirectLinks }),
      });
    });

    it('calls onError and does not post when prepareCart rejects', async () => {
      const onError = jest.fn();
      const error = new Error('Product could not be added');
      mockFetch(() => jsonResponse(200, widgetEnabled()));

      await mountAndSubmit({ onError, prepareCart: () => Promise.reject(error) });

      expect(onError).toHaveBeenCalledWith(error);
      expect(fetchedUrls().some((url) => url.endsWith('/payments/express'))).toBe(false);
    });

    it('calls onError with the body on a non-2xx express response', async () => {
      const onError = jest.fn();
      const onSuccess = jest.fn();
      const errorBody = { statusCode: 400, errors: [{ code: 'InvalidAmount' }] };
      mockFetch((url) =>
        url.endsWith('/payments/express') ? jsonResponse(400, errorBody) : jsonResponse(200, widgetEnabled()),
      );

      await mountAndSubmit({ onError, onSuccess });

      expect(onError).toHaveBeenCalledWith(errorBody);
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it('calls onError with the status on a non-JSON express error response', async () => {
      const onError = jest.fn();
      mockFetch((url) =>
        url.endsWith('/payments/express') ? nonJsonResponse(504) : jsonResponse(200, widgetEnabled()),
      );

      await mountAndSubmit({ onError });

      expect(onError).toHaveBeenCalledWith({ statusCode: 504 });
    });

    it('calls onError and does not post for an unknown payment type', async () => {
      const onError = jest.fn();
      mockFetch(() => jsonResponse(200, widgetEnabled()));

      await mountAndSubmit({ onError }, 'UNKNOWN');

      expect(onError).toHaveBeenCalled();
      expect(fetchedUrls().some((url) => url.endsWith('/payments/express'))).toBe(false);
    });
  });
});
