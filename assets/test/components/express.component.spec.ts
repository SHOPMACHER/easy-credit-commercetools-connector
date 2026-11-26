/* eslint-disable no-global-assign */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ECExpressButtonComponent, ECExpressButtonComponentBuilder } from '../../src/components/express.component';
import { ExpressButtonBaseOptions, ExpressButtonComponentOptions, ExpressButtonPlacement } from '../../src/types/main';
import { importEasyCreditScript } from '../../src/utils/app.utils';
import { suppressEasyCreditAlert } from '../../src/utils/easycredit-alert.utils';

// Keep the real findElement: the submit event is dispatched on the rendered element.
jest.mock('../../src/utils/app.utils', () => ({
  ...(jest.requireActual('../../src/utils/app.utils') as object),
  importEasyCreditScript: jest.fn(),
}));

jest.mock('../../src/utils/easycredit-alert.utils', () => ({ suppressEasyCreditAlert: jest.fn() }));

const FALLBACK =
  'Die Zahlung mit easyCredit konnte nicht gestartet werden. Bitte versuchen Sie es erneut oder wählen Sie eine andere Zahlungsart.';

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

// The PDP requires prepareCart, so the default PDP component has one.
type Overrides = Partial<ExpressButtonBaseOptions> & {
  placement?: ExpressButtonPlacement;
  prepareCart?: ExpressButtonComponentOptions['prepareCart'];
  productTypeId?: string;
};

const createComponent = (options: Overrides = {}) =>
  new ECExpressButtonComponentBuilder(baseOptions).build({
    placement: 'PDP',
    amount: 299.9,
    redirectLinks,
    prepareCart: async () => 'prepared-session',
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
  let warnSpy: jest.SpiedFunction<typeof console.warn>;
  let errorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    document.body.innerHTML = '<div id="express"></div>';
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    warnSpy.mockRestore();
    errorSpy.mockRestore();
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

    it('on PDP renders nothing and logs an error without prepareCart', async () => {
      mockFetch(() => jsonResponse(200, widgetEnabled()));
      await expect(createComponent().mount('#express')).resolves.toBe(true);

      await expect(createComponent({ prepareCart: undefined }).mount('#express')).resolves.toBe(false);

      expect(renderedButton()).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('prepareCart is required'));
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('on PDP without prepareCart logs once per component and never fetches on setAmount', async () => {
      mockFetch(() => jsonResponse(200, widgetEnabled()));
      const component = createComponent({ prepareCart: undefined });

      await expect(component.mount('#express')).resolves.toBe(false);
      await expect(component.setAmount(199.9)).resolves.toBe(false);
      await expect(component.setAmount(99.9)).resolves.toBe(false);

      expect(renderedButton()).toBeNull();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('sends productTypeId on PDP', async () => {
      mockFetch(() => jsonResponse(200, widgetEnabled()));

      await createComponent({ productTypeId: 'pt-1' }).mount('#express');

      expect(fetchedUrls()[0]).toBe('https://processor.example.com/operations/widget-enabled?productTypeId=pt-1');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it.each([undefined, ''])('omits productTypeId %p and warns on PDP', async (productTypeId) => {
      mockFetch(() => jsonResponse(200, widgetEnabled()));

      await createComponent({ productTypeId }).mount('#express');

      expect(fetchedUrls()[0]).toBe('https://processor.example.com/operations/widget-enabled');
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('warns only once per component across mounts', async () => {
      mockFetch(() => jsonResponse(200, widgetEnabled()));
      const component = createComponent();

      await component.mount('#express');
      await component.mount('#express');

      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('does not send productTypeId or warn on CART', async () => {
      mockFetch(() => jsonResponse(200, widgetEnabled()));

      await createComponent({ placement: 'CART', productTypeId: 'pt-1' }).mount('#express');

      expect(fetchedUrls()[0]).toBe('https://processor.example.com/operations/widget-enabled');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('logs and renders nothing on a non-200 widget-enabled', async () => {
      mockFetch(() => jsonResponse(400, { statusCode: 400, errors: [] }));

      await expect(createComponent({ productTypeId: 'pt-1' }).mount('#express')).resolves.toBe(false);

      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to get EasyCredit Express Button config 400. Check that productTypeId is the product type ID (a UUID).',
      );
      expect(renderedButton()).toBeNull();
    });

    it('drops a type outside the merchant limits on PDP', async () => {
      mockFetch(() =>
        jsonResponse(200, widgetEnabled({ amountLimits: { BILL_PAYMENT: { minAmount: 0, maxAmount: 100 } } })),
      );

      await createComponent({ amount: 299.9, productTypeId: 'pt-1' }).mount('#express');

      expect(renderedButton()?.getAttribute('payment-types')).toBe('INSTALLMENT');
    });

    it('renders nothing on PDP when the merchant limits exclude every type', async () => {
      mockFetch(() =>
        jsonResponse(
          200,
          widgetEnabled({
            amountLimits: {
              INSTALLMENT_PAYMENT: { minAmount: 0, maxAmount: 100 },
              BILL_PAYMENT: { minAmount: 0, maxAmount: 100 },
            },
          }),
        ),
      );

      await expect(createComponent({ productTypeId: 'pt-1' }).mount('#express')).resolves.toBe(false);
    });

    it('does not apply merchant limits on CART', async () => {
      mockFetch((url) =>
        url.endsWith('/operations/widget-enabled')
          ? jsonResponse(200, widgetEnabled({ amountLimits: { BILL_PAYMENT: { minAmount: 0, maxAmount: 100 } } }))
          : jsonResponse(200, { webShopId: 'shop-id' }),
      );

      await createComponent({ placement: 'CART' }).mount('#express');

      expect(renderedButton()?.getAttribute('payment-types')).toBe('INSTALLMENT,BILL');
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

  describe('fullWidth', () => {
    it('does not set full-width by default', async () => {
      mockFetch(() => jsonResponse(200, widgetEnabled()));

      await createComponent().mount('#express');

      expect(renderedButton()?.hasAttribute('full-width')).toBe(false);
    });

    it('sets full-width on mount and on the element setAmount renders', async () => {
      mockFetch(() => jsonResponse(200, widgetEnabled()));
      const c = createComponent({ fullWidth: true, productTypeId: 'pt-1' });

      await c.mount('#express');
      expect(renderedButton()?.getAttribute('full-width')).toBe('true');

      await c.setAmount(149.5);
      expect(renderedButton()?.getAttribute('full-width')).toBe('true');
    });
  });

  describe('setAmount', () => {
    const billMax100 = () =>
      jsonResponse(200, widgetEnabled({ amountLimits: { BILL_PAYMENT: { minAmount: 0, maxAmount: 100 } } }));

    // easyCredit's modal computes its total once, so a changed amount needs a new element.
    it('replaces the element with one for the new amount', async () => {
      mockFetch(() => jsonResponse(200, widgetEnabled()));
      const c = createComponent({ productTypeId: 'pt-1' });
      await c.mount('#express');
      const before = renderedButton();

      expect(await c.setAmount(149.5)).toBe(true);

      expect(renderedButton()).not.toBe(before);
      expect(renderedButton()?.getAttribute('amount')).toBe('149.5');
      expect(renderedButton()?.getAttribute('payment-types')).toBe('INSTALLMENT,BILL');
      expect(document.querySelectorAll('#express easycredit-express-button')).toHaveLength(1);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('replaces the element when the merchant limits change the types', async () => {
      mockFetch(billMax100);
      const c = createComponent({ amount: 50, productTypeId: 'pt-1' });
      await c.mount('#express');
      const before = renderedButton();
      expect(before?.getAttribute('payment-types')).toBe('INSTALLMENT,BILL');

      expect(await c.setAmount(200)).toBe(true);

      const buttons = document.querySelectorAll('#express easycredit-express-button');
      expect(buttons).toHaveLength(1);
      expect(buttons[0]).not.toBe(before);
      expect(buttons[0].getAttribute('payment-types')).toBe('INSTALLMENT');
      expect(buttons[0].getAttribute('amount')).toBe('200');

      expect(await c.setAmount(50)).toBe(true);
      expect(renderedButton()?.getAttribute('payment-types')).toBe('INSTALLMENT,BILL');
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('removes the button and resolves false when the merchant limits exclude every type', async () => {
      const limit100 = { minAmount: 0, maxAmount: 100 };
      mockFetch(() =>
        jsonResponse(200, widgetEnabled({ amountLimits: { INSTALLMENT_PAYMENT: limit100, BILL_PAYMENT: limit100 } })),
      );
      const c = createComponent({ amount: 50, productTypeId: 'pt-1' });
      await c.mount('#express');

      expect(await c.setAmount(200)).toBe(false);
      expect(renderedButton()).toBeNull();

      // The config is loaded, so an amount inside the limits renders again without a second fetch.
      expect(await c.setAmount(50)).toBe(true);
      expect(renderedButton()?.getAttribute('payment-types')).toBe('INSTALLMENT,BILL');
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('removes the button and resolves false for a non-finite amount', async () => {
      mockFetch(() => jsonResponse(200, widgetEnabled()));
      const c = createComponent({ productTypeId: 'pt-1' });
      await c.mount('#express');

      expect(await c.setAmount(NaN)).toBe(false);

      expect(renderedButton()).toBeNull();
    });

    it('brings the button back after a non-finite amount', async () => {
      mockFetch(() => jsonResponse(200, widgetEnabled()));
      const c = createComponent({ amount: NaN, productTypeId: 'pt-1' });
      await expect(c.mount('#express')).resolves.toBe(false);
      expect(fetch).not.toHaveBeenCalled();

      expect(await c.setAmount(100)).toBe(true);

      expect(renderedButton()?.getAttribute('amount')).toBe('100');
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('applies an amount set before mount resolves', async () => {
      mockFetch(() => jsonResponse(200, widgetEnabled()));
      const c = createComponent({ productTypeId: 'pt-1' });
      const mounting = c.mount('#express');

      const updating = c.setAmount(77);

      await expect(mounting).resolves.toBe(true);
      await expect(updating).resolves.toBe(true);
      expect(renderedButton()?.getAttribute('amount')).toBe('77');
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('mounts for an amount set right after a mount that started without one', async () => {
      mockFetch(() => jsonResponse(200, widgetEnabled()));
      const c = createComponent({ amount: NaN, productTypeId: 'pt-1' });
      const mounting = c.mount('#express');

      expect(await c.setAmount(100)).toBe(true);

      await expect(mounting).resolves.toBe(false);
      expect(renderedButton()?.getAttribute('amount')).toBe('100');
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('renders nothing when a non-finite amount is set before mount resolves', async () => {
      mockFetch(() => jsonResponse(200, widgetEnabled()));
      const c = createComponent({ productTypeId: 'pt-1' });
      const mounting = c.mount('#express');

      await expect(c.setAmount(NaN)).resolves.toBe(false);

      await expect(mounting).resolves.toBe(false);
      expect(renderedButton()).toBeNull();
    });

    it('does nothing for a stale instance', async () => {
      mockFetch(() => jsonResponse(200, widgetEnabled()));
      const a = createComponent({ productTypeId: 'pt-1' });
      const b = createComponent({ productTypeId: 'pt-1', amount: 200 });
      await a.mount('#express');
      await b.mount('#express');
      const bButton = renderedButton();

      expect(await a.setAmount(NaN)).toBe(false);
      expect(await a.setAmount(10)).toBe(false);

      expect(renderedButton()).toBe(bButton);
      expect(bButton?.getAttribute('amount')).toBe('200');
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('keeps the state of the latest mount when an earlier mount of the same component finishes last', async () => {
      const pending: ((value: unknown) => void)[] = [];
      (fetch as jest.Mock).mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
      const c = createComponent({ amount: 50, productTypeId: 'pt-1' });

      const first = c.mount('#express');
      const second = c.mount('#express');
      await new Promise((resolve) => setTimeout(resolve, 0));
      pending[1](jsonResponse(200, widgetEnabled({ webShopId: 'latest' })));
      await expect(second).resolves.toBe(true);
      pending[0](
        jsonResponse(200, widgetEnabled({ amountLimits: { BILL_PAYMENT: { minAmount: 0, maxAmount: 100 } } })),
      );
      await expect(first).resolves.toBe(false);

      // The stale mount's limits would drop BILL.
      expect(await c.setAmount(200)).toBe(true);
      expect(renderedButton()?.getAttribute('payment-types')).toBe('INSTALLMENT,BILL');
      expect(renderedButton()?.getAttribute('webshop-id')).toBe('latest');
    });

    it('rejects on CART', async () => {
      await expect(createComponent({ placement: 'CART' }).setAmount(10)).rejects.toThrow('remount');
    });

    it('does not mutate the options of the shop', async () => {
      mockFetch(() => jsonResponse(200, widgetEnabled()));
      const options: ExpressButtonComponentOptions = {
        placement: 'PDP',
        amount: 10,
        productTypeId: 'pt-1',
        redirectLinks,
        prepareCart: async () => 'prepared-session',
        onError: jest.fn(),
        onSuccess: jest.fn(),
      };
      const c = new ECExpressButtonComponentBuilder(baseOptions).build(options);
      await c.mount('#express');

      await c.setAmount(20);

      expect(options.amount).toBe(10);
      expect(renderedButton()?.getAttribute('amount')).toBe('20');
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

    const errorBodyFixture = { statusCode: 400, errors: [{ code: 'InvalidAmount', message: 'x' }] };
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
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': 'prepared-session' },
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

    it('opens the alert window on every easycredit-submit, also while a submit runs', async () => {
      let resolvePost: (value: unknown) => void = () => {};
      mockFetch((url) =>
        url.endsWith('/payments/express')
          ? new Promise((resolve) => (resolvePost = resolve))
          : jsonResponse(200, widgetEnabled()),
      );
      await createComponent().mount('#express');
      const click = () =>
        renderedButton()?.dispatchEvent(new CustomEvent('easycredit-submit', { detail: { paymentType: 'BILL' } }));

      click();
      click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(suppressEasyCreditAlert).toHaveBeenCalledTimes(2);
      expect(fetchedUrls().filter((url) => url.endsWith('/payments/express'))).toHaveLength(1);
      resolvePost(jsonResponse(201, createdPayment));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    it('passes a processor error body through', async () => {
      const onError = jest.fn();
      const onSuccess = jest.fn();
      const errorBody = { statusCode: 400, errors: [{ code: 'InvalidAmount', message: 'x' }] };
      mockFetch((url) =>
        url.endsWith('/payments/express') ? jsonResponse(400, errorBody) : jsonResponse(200, widgetEnabled()),
      );

      await mountAndSubmit({ onError, onSuccess });

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(errorBody);
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it('normalises a JSON body without errors', async () => {
      const onError = jest.fn();
      const body = { message: 'Not Found', statusCode: 404 };
      mockFetch((url) =>
        url.endsWith('/payments/express') ? jsonResponse(404, body) : jsonResponse(200, widgetEnabled()),
      );

      await mountAndSubmit({ onError });

      expect(onError).toHaveBeenCalledWith({
        statusCode: 404,
        errors: [{ code: 'UnexpectedResponse', message: FALLBACK }],
        cause: body,
      });
    });

    it('normalises a body with an empty errors list', async () => {
      const onError = jest.fn();
      const body = { statusCode: 502, errors: [] };
      mockFetch((url) =>
        url.endsWith('/payments/express') ? jsonResponse(502, body) : jsonResponse(200, widgetEnabled()),
      );

      await mountAndSubmit({ onError });

      expect(onError).toHaveBeenCalledWith({
        statusCode: 502,
        errors: [{ code: 'UnexpectedResponse', message: FALLBACK }],
        cause: body,
      });
    });

    it('normalises a non-JSON response', async () => {
      const onError = jest.fn();
      mockFetch((url) =>
        url.endsWith('/payments/express') ? nonJsonResponse(502) : jsonResponse(200, widgetEnabled()),
      );

      await mountAndSubmit({ onError });

      expect(onError).toHaveBeenCalledWith({
        statusCode: 502,
        errors: [{ code: 'UnexpectedResponse', message: FALLBACK }],
        cause: expect.any(SyntaxError),
      });
    });

    it('normalises a network error', async () => {
      const onError = jest.fn();
      const error = new TypeError('Failed to fetch');
      mockFetch((url) => {
        if (url.endsWith('/payments/express')) throw error;
        return jsonResponse(200, widgetEnabled());
      });

      await mountAndSubmit({ onError });

      expect(onError).toHaveBeenCalledWith({
        errors: [{ code: 'ExpressInitFailed', message: FALLBACK }],
        cause: error,
      });
    });

    it('normalises a prepareCart error and does not post', async () => {
      const onError = jest.fn();
      const error = new Error('Product could not be added');
      mockFetch(() => jsonResponse(200, widgetEnabled()));

      await mountAndSubmit({ onError, prepareCart: () => Promise.reject(error) });

      expect(onError).toHaveBeenCalledWith({
        errors: [{ code: 'ExpressInitFailed', message: FALLBACK }],
        cause: error,
      });
      expect(fetchedUrls().some((url) => url.endsWith('/payments/express'))).toBe(false);
    });

    it('normalises an unknown payment type and does not post', async () => {
      const onError = jest.fn();
      mockFetch(() => jsonResponse(200, widgetEnabled()));

      await mountAndSubmit({ onError }, 'UNKNOWN');

      expect(onError).toHaveBeenCalledWith({
        errors: [{ code: 'ExpressInitFailed', message: FALLBACK }],
        cause: expect.any(Error),
      });
      expect(fetchedUrls().some((url) => url.endsWith('/payments/express'))).toBe(false);
    });

    it('replaces the button before calling onError', async () => {
      let buttonInOnError: Element | null = null;
      const onError = jest.fn(() => {
        buttonInOnError = renderedButton();
      });
      mockFetch((url) =>
        url.endsWith('/payments/express') ? nonJsonResponse(502) : jsonResponse(200, widgetEnabled()),
      );
      const component = createComponent({ onError, amount: 50, productTypeId: 'pt-1', fullWidth: true });
      await component.mount('#express');
      const clicked = renderedButton();

      clicked?.dispatchEvent(new CustomEvent('easycredit-submit', { detail: { paymentType: 'BILL' } }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onError).toHaveBeenCalledTimes(1);
      expect(buttonInOnError).not.toBeNull();
      expect(buttonInOnError).not.toBe(clicked);
      expect(document.querySelectorAll('#express easycredit-express-button')).toHaveLength(1);
      for (const name of ['webshop-id', 'amount', 'payment-types']) {
        expect(buttonInOnError!.getAttribute(name)).toBe(clicked?.getAttribute(name));
      }
      expect(buttonInOnError!.getAttribute('full-width')).toBe('true');
    });

    it('calls a throwing onError once and does not reject unhandled', async () => {
      const onError = jest.fn(() => {
        throw new Error('shop bug');
      });
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      const unhandled = jest.fn();
      process.on('unhandledRejection', unhandled);
      mockFetch((url) =>
        url.endsWith('/payments/express') ? jsonResponse(400, errorBodyFixture) : jsonResponse(200, widgetEnabled()),
      );
      const component = createComponent({ onError, amount: 50, productTypeId: 'pt-1' });
      await component.mount('#express');
      const clicked = renderedButton();
      const replaced = jest.spyOn(clicked as Element, 'replaceWith');

      clicked?.dispatchEvent(new CustomEvent('easycredit-submit', { detail: { paymentType: 'BILL' } }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      process.off('unhandledRejection', unhandled);

      expect(onError).toHaveBeenCalledTimes(1);
      expect(replaced).toHaveBeenCalledTimes(1);
      expect(unhandled).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('only logs a throwing onSuccess', async () => {
      const onError = jest.fn();
      const onSuccess = jest.fn(() => {
        throw new Error('shop bug');
      });
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch((url) =>
        url.endsWith('/payments/express') ? jsonResponse(201, createdPayment) : jsonResponse(200, widgetEnabled()),
      );

      await mountAndSubmit({ onError, onSuccess });

      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('removes the button on error when no type is shown for the current amount', async () => {
      const onError = jest.fn();
      mockFetch((url) =>
        url.endsWith('/payments/express')
          ? nonJsonResponse(502)
          : jsonResponse(200, widgetEnabled({ amountLimits: { BILL_PAYMENT: { minAmount: 0, maxAmount: 100 } } })),
      );
      const component = createComponent({ onError, amount: 50, productTypeId: 'pt-1' });
      await component.mount('#express');
      const clicked = renderedButton();
      // Not reachable via setAmount (it removes the button itself), so force the state.
      (component as unknown as { amount: number }).amount = 200;
      (component as unknown as { paymentTypes: string[] }).paymentTypes = ['BILL_PAYMENT'];

      clicked?.dispatchEvent(new CustomEvent('easycredit-submit', { detail: { paymentType: 'BILL' } }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onError).toHaveBeenCalledTimes(1);
      expect(renderedButton()).toBeNull();
    });

    it('replaces the button with the types shown for the current amount', async () => {
      const onError = jest.fn();
      mockFetch((url) =>
        url.endsWith('/payments/express')
          ? nonJsonResponse(502)
          : jsonResponse(200, widgetEnabled({ amountLimits: { BILL_PAYMENT: { minAmount: 0, maxAmount: 100 } } })),
      );
      const component = createComponent({ onError, amount: 50, productTypeId: 'pt-1' });
      await component.mount('#express');
      await component.setAmount(200);
      const clicked = renderedButton();

      clicked?.dispatchEvent(new CustomEvent('easycredit-submit', { detail: { paymentType: 'INSTALLMENT' } }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onError).toHaveBeenCalledTimes(1);
      expect(renderedButton()).not.toBe(clicked);
      expect(renderedButton()?.getAttribute('payment-types')).toBe('INSTALLMENT');
      expect(renderedButton()?.getAttribute('amount')).toBe('200');
    });

    it('posts once per click from a button replaced on the error path or by setAmount', async () => {
      let fail = true;
      mockFetch((url) => {
        if (!url.endsWith('/payments/express')) {
          return jsonResponse(200, widgetEnabled({ amountLimits: { BILL_PAYMENT: { minAmount: 0, maxAmount: 100 } } }));
        }
        return fail ? nonJsonResponse(502) : jsonResponse(201, createdPayment);
      });
      const component = createComponent({ amount: 50, productTypeId: 'pt-1' });
      await component.mount('#express');
      const click = async () => {
        renderedButton()?.dispatchEvent(
          new CustomEvent('easycredit-submit', { detail: { paymentType: 'INSTALLMENT' } }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      };
      const posts = () => fetchedUrls().filter((url) => url.endsWith('/payments/express')).length;

      await click();
      expect(posts()).toBe(1);

      fail = false;
      await click();
      expect(posts()).toBe(2);
      expect(suppressEasyCreditAlert).toHaveBeenCalledTimes(2);

      await component.setAmount(200);
      await click();
      expect(posts()).toBe(3);
      expect(suppressEasyCreditAlert).toHaveBeenCalledTimes(3);
    });

    it('leaves the button of a later mount alone on the error path', async () => {
      const onError = jest.fn();
      mockFetch((url) =>
        url.endsWith('/payments/express') ? nonJsonResponse(502) : jsonResponse(200, widgetEnabled()),
      );
      await createComponent({ onError }).mount('#express');
      const stale = renderedButton();
      await createComponent().mount('#express');
      const current = renderedButton();

      stale?.dispatchEvent(new CustomEvent('easycredit-submit', { detail: { paymentType: 'BILL' } }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onError).toHaveBeenCalledTimes(1);
      expect(renderedButton()).toBe(current);
      expect(document.querySelectorAll('#express easycredit-express-button')).toHaveLength(1);
    });

    it('calls onError when the old button fails while a remount is loading', async () => {
      const onError = jest.fn();
      let widgetCalls = 0;
      mockFetch((url) => {
        if (url.endsWith('/payments/express')) return jsonResponse(400, errorBodyFixture);
        widgetCalls += 1;
        // The second widget-enabled request never settles.
        return widgetCalls === 1 ? jsonResponse(200, widgetEnabled()) : new Promise(() => undefined);
      });
      const component = createComponent({ onError });
      await component.mount('#express');
      const old = renderedButton();
      void component.mount('#express');

      old?.dispatchEvent(new CustomEvent('easycredit-submit', { detail: { paymentType: 'BILL' } }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onError).toHaveBeenCalledTimes(1);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('keeps the button on success', async () => {
      const onSuccess = jest.fn();
      mockFetch((url) =>
        url.endsWith('/payments/express') ? jsonResponse(201, createdPayment) : jsonResponse(200, widgetEnabled()),
      );
      await createComponent({ onSuccess }).mount('#express');
      const clicked = renderedButton();

      clicked?.dispatchEvent(new CustomEvent('easycredit-submit', { detail: { paymentType: 'BILL' } }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onSuccess).toHaveBeenCalledWith(createdPayment);
      expect(renderedButton()).toBe(clicked);
    });
  });
});
