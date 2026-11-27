/* eslint-disable no-global-assign */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { importEasyCreditScript, waitForEasyCreditElement } from '../../src/utils/app.utils';
import { ECWidgetComponent, ECWidgetComponentBuilder } from '../../src/components/widget.component';
import { holdRender as holdWidgetRender } from '../render.helpers';

// Keep the real findElement: the widget renders into a real container.
jest.mock('../../src/utils/app.utils', () => {
  const actual = jest.requireActual('../../src/utils/app.utils') as typeof import('../../src/utils/app.utils');

  return {
    ...actual,
    importEasyCreditScript: jest.fn(),
    waitForEasyCreditElement: jest.fn(actual.waitForEasyCreditElement),
  };
});
// @ts-expect-error: Mock fetch globally
fetch = jest.fn() as jest.Mock;

const mockWebComponentOptions = {
  processorUrl: 'https://test-processor-url.com',
  sessionId: 'mock-session-id',
};

const mockWidgetConfigEnabled = {
  isEnabled: true,
  webShopId: 'mock-webshop-id',
};

const mockWidgetConfigDisabled = {
  isEnabled: false,
};

const respondWith = (config: object) =>
  (fetch as jest.Mock).mockImplementation(async () => ({
    ok: true,
    json: async () => config,
  }));

const createComponent = (amount: number = 100) =>
  new ECWidgetComponent({
    processorUrl: mockWebComponentOptions.processorUrl,
    widgetComponentOptions: { amount },
  });

const container = () => document.getElementById('widget-element') as HTMLElement;
const widgets = () => Array.from(container().querySelectorAll<HTMLElement>('easycredit-widget'));
const shownWidget = () => widgets().find((widget) => widget.style.visibility !== 'hidden');

const holdRender = () => holdWidgetRender('easycredit-widget');

describe('ECWidgetComponentBuilder', () => {
  it('should build an ECWidgetComponent', () => {
    const builder = new ECWidgetComponentBuilder(mockWebComponentOptions);
    const component = builder.build({ amount: 100 });

    expect(component).toBeInstanceOf(ECWidgetComponent);

    expect((component as any).processorUrl).toBe(mockWebComponentOptions.processorUrl);
  });
});

describe('ECWidgetComponent', () => {
  let component: ECWidgetComponent;

  beforeEach(() => {
    document.body.innerHTML = '<div id="widget-element"></div>';
    component = createComponent();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should mount the widget when enabled and resolve true once it has rendered', async () => {
    respondWith(mockWidgetConfigEnabled);

    await expect(component.mount('#widget-element')).resolves.toBe(true);

    expect(fetch).toHaveBeenCalledWith(
      `${mockWebComponentOptions.processorUrl}/operations/widget-enabled?placement=PDP`,
      expect.anything(),
    );
    expect(importEasyCreditScript).toHaveBeenCalled();
    expect(widgets()).toHaveLength(1);
    expect(shownWidget()?.getAttribute('amount')).toBe('100');
    expect(shownWidget()?.getAttribute('webshop-id')).toBe('mock-webshop-id');
    expect(shownWidget()?.hasAttribute('payment-types')).toBe(false);
  });

  it('should accept the container element instead of a selector', async () => {
    respondWith(mockWidgetConfigEnabled);

    await expect(component.mount(container())).resolves.toBe(true);

    expect(widgets()).toHaveLength(1);
  });

  it.each([
    [['INSTALLMENT_PAYMENT', 'BILL_PAYMENT'], 'INSTALLMENT,BILL'],
    [['BILL_PAYMENT'], 'BILL'],
    [['INSTALLMENT_PAYMENT', 'UNKNOWN'], 'INSTALLMENT'],
    [undefined, null],
  ])('should render payment-types for %j', async (paymentTypes, attribute) => {
    respondWith({ ...mockWidgetConfigEnabled, paymentTypes });

    await component.mount('#widget-element');

    expect(shownWidget()?.getAttribute('payment-types')).toBe(attribute);
  });

  it.each([[[]], [['UNKNOWN']]])(
    'should not mount the widget when checkout offers no known payment type (%j)',
    async (paymentTypes) => {
      respondWith({ ...mockWidgetConfigEnabled, paymentTypes });

      await expect(component.mount('#widget-element')).resolves.toBe(false);

      expect(importEasyCreditScript).not.toHaveBeenCalled();
      expect(widgets()).toHaveLength(0);
    },
  );

  describe('merchant amount limits', () => {
    const mountWith = async (amount: number, config: object) => {
      component = createComponent(amount);
      respondWith({ ...mockWidgetConfigEnabled, ...config });

      return component.mount('#widget-element');
    };

    it.each([
      [99.99, 'INSTALLMENT'],
      [100, 'INSTALLMENT,BILL'],
      [1000, 'INSTALLMENT,BILL'],
      [1000.01, 'INSTALLMENT'],
    ])('should advertise bill payment at amount %s only within its limits', async (amount, attribute) => {
      await mountWith(amount, {
        paymentTypes: ['INSTALLMENT_PAYMENT', 'BILL_PAYMENT'],
        amountLimits: { BILL_PAYMENT: { minAmount: 100, maxAmount: 1000 } },
      });

      expect(shownWidget()?.getAttribute('amount')).toBe(String(amount));
      expect(shownWidget()?.getAttribute('payment-types')).toBe(attribute);
    });

    it('should not mount the widget if the amount is outside the limits of every payment type', async () => {
      await expect(
        mountWith(50, {
          paymentTypes: ['INSTALLMENT_PAYMENT'],
          amountLimits: { INSTALLMENT_PAYMENT: { minAmount: 500, maxAmount: 8000 } },
        }),
      ).resolves.toBe(false);

      expect(importEasyCreditScript).not.toHaveBeenCalled();
      expect(widgets()).toHaveLength(0);
    });

    it.each([
      [Number.NaN, 'INSTALLMENT'],
      [Number.POSITIVE_INFINITY, 'INSTALLMENT'],
      ['250.00', 'INSTALLMENT,BILL'],
      ['1500', 'INSTALLMENT'],
    ])('should only advertise a limited payment type for a finite amount, given %s', async (amount, attribute) => {
      await mountWith(amount as number, {
        paymentTypes: ['INSTALLMENT_PAYMENT', 'BILL_PAYMENT'],
        amountLimits: { BILL_PAYMENT: { minAmount: 100, maxAmount: 1000 } },
      });

      expect(shownWidget()?.getAttribute('amount')).toBe(String(amount));
      expect(shownWidget()?.getAttribute('payment-types')).toBe(attribute);
    });

    it('should leave the limits to the widget if the processor sends none', async () => {
      await mountWith(10, { paymentTypes: ['INSTALLMENT_PAYMENT', 'BILL_PAYMENT'] });

      expect(shownWidget()?.getAttribute('payment-types')).toBe('INSTALLMENT,BILL');
    });
  });

  it.each([0, -5, '0'])('should render nothing and send no request for the amount %j', async (amount) => {
    component = createComponent(amount as number);

    await expect(component.mount('#widget-element')).resolves.toBe(false);

    expect(fetch).not.toHaveBeenCalled();
    expect(widgets()).toHaveLength(0);
  });

  it('should not mount the widget if it is disabled', async () => {
    respondWith(mockWidgetConfigDisabled);

    await expect(component.mount('#widget-element')).resolves.toBe(false);

    expect(importEasyCreditScript).not.toHaveBeenCalled();
    expect(widgets()).toHaveLength(0);
  });

  it('should log an error and resolve false if fetchConfig fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    (fetch as jest.Mock).mockImplementation(async () => Promise.reject(new Error('Failed to fetch')));

    await expect(component.mount('#widget-element')).resolves.toBe(false);

    expect(consoleSpy).toHaveBeenCalledWith('Failed to get EasyCredit Widget', expect.any(Error));
  });

  it('should log an error and resolve false if the container does not exist', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(component.mount('#missing')).resolves.toBe(false);

    expect(consoleSpy).toHaveBeenCalledWith('Failed to get EasyCredit Widget', expect.any(Error));
    expect(fetch).not.toHaveBeenCalled();
  });

  describe('rendering', () => {
    it('should keep the new widget hidden and the mount pending until it has rendered', async () => {
      respondWith(mockWidgetConfigEnabled);
      const release = holdRender();
      let settled = false;

      const mounting = component.mount('#widget-element').then((shown) => {
        settled = true;

        return shown;
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(settled).toBe(false);
      expect(widgets()).toHaveLength(1);
      // Not display: none: easyCredit would measure 0 px and keep its small layout.
      expect(widgets()[0].style.display).toBe('');
      expect(widgets()[0].style.visibility).toBe('hidden');
      expect(widgets()[0].style.height).toBe('0px');

      release();

      await expect(mounting).resolves.toBe(true);
      expect(widgets()[0].getAttribute('style')).toBeNull();
    });

    it('should keep the old widget until the widget of a remount has rendered', async () => {
      respondWith(mockWidgetConfigEnabled);
      await component.mount('#widget-element');
      const release = holdRender();

      const remount = createComponent(250).mount('#widget-element');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(shownWidget()?.getAttribute('amount')).toBe('100');

      release();

      await expect(remount).resolves.toBe(true);
      expect(widgets()).toHaveLength(1);
      expect(shownWidget()?.getAttribute('amount')).toBe('250');
    });

    it('should not duplicate the widget on a remount and keep other content of the container', async () => {
      container().innerHTML = '<p id="shop-note">Shop text</p>';
      respondWith(mockWidgetConfigEnabled);

      await component.mount('#widget-element');
      await component.mount('#widget-element');

      expect(widgets()).toHaveLength(1);
      expect(document.getElementById('shop-note')).not.toBeNull();
    });

    it('should let only the latest mount of a container render', async () => {
      let releaseSlow: () => void = () => {};
      (fetch as jest.Mock)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releaseSlow = () => resolve({ ok: true, json: async () => mockWidgetConfigEnabled });
            }),
        )
        .mockImplementationOnce(async () => ({ ok: true, json: async () => mockWidgetConfigEnabled }));

      const slow = createComponent(100).mount('#widget-element');
      const fast = createComponent(250).mount('#widget-element');

      await expect(fast).resolves.toBe(true);
      releaseSlow();
      // The overtaken mount resolves with the result of the latest one, so a shop can apply every result.
      await expect(slow).resolves.toBe(true);

      expect(widgets()).toHaveLength(1);
      expect(shownWidget()?.getAttribute('amount')).toBe('250');
    });

    it('should drop a widget whose mount was overtaken while it waited for the render', async () => {
      respondWith(mockWidgetConfigEnabled);
      const release = holdRender();
      const overtaken = createComponent(100).mount('#widget-element');
      await new Promise((resolve) => setTimeout(resolve, 0));

      await expect(createComponent(250).mount('#widget-element')).resolves.toBe(true);
      release();

      await expect(overtaken).resolves.toBe(true);
      expect(widgets()).toHaveLength(1);
      expect(shownWidget()?.getAttribute('amount')).toBe('250');
    });

    it('should keep the latest widget when an overtaken mount gets a disabled config', async () => {
      let releaseSlow: () => void = () => {};
      (fetch as jest.Mock)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releaseSlow = () => resolve({ ok: true, json: async () => mockWidgetConfigDisabled });
            }),
        )
        .mockImplementationOnce(async () => ({ ok: true, json: async () => mockWidgetConfigEnabled }));

      const slow = createComponent(100).mount('#widget-element');
      await expect(createComponent(250).mount('#widget-element')).resolves.toBe(true);
      releaseSlow();

      await expect(slow).resolves.toBe(true);
      expect(shownWidget()?.getAttribute('amount')).toBe('250');
    });

    it('should remove an earlier widget when a new mount fails', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      respondWith(mockWidgetConfigEnabled);
      await component.mount('#widget-element');
      (fetch as jest.Mock).mockImplementation(async () => Promise.reject(new Error('Failed to fetch')));

      await expect(createComponent(250).mount('#widget-element')).resolves.toBe(false);

      expect(widgets()).toHaveLength(0);
    });

    it('should remove the widget and resolve false if the easyCredit script fails to load', async () => {
      respondWith(mockWidgetConfigEnabled);
      (waitForEasyCreditElement as jest.Mock).mockImplementationOnce(async () => 'failed');

      await expect(component.mount('#widget-element')).resolves.toBe(false);

      expect(widgets()).toHaveLength(0);
    });

    it('should show the widget and resolve true after the render timeout', async () => {
      respondWith(mockWidgetConfigEnabled);
      (waitForEasyCreditElement as jest.Mock).mockImplementationOnce(async () => 'timeout');

      await expect(component.mount('#widget-element')).resolves.toBe(true);

      expect(shownWidget()).toBeDefined();
    });
  });

  it('should fetch the widget configuration successfully', async () => {
    respondWith(mockWidgetConfigEnabled);

    const config = await component.fetchConfig();

    expect(config).toEqual(mockWidgetConfigEnabled);
  });

  describe('placement', () => {
    const widgetUrl = `${mockWebComponentOptions.processorUrl}/operations/widget-enabled`;
    const build = (placement?: unknown) =>
      new ECWidgetComponent({
        processorUrl: mockWebComponentOptions.processorUrl,
        widgetComponentOptions: { amount: 100, placement: placement as never },
      });

    beforeEach(() => {
      (fetch as jest.Mock).mockImplementation(async () =>
        // @ts-expect-error test
        Promise.resolve({ ok: true, json: jest.fn().mockResolvedValueOnce(mockWidgetConfigDisabled) }),
      );
    });

    afterEach(() => {
      window.history.pushState({}, '', '/');
    });

    it('should send placement when it is set', async () => {
      window.history.pushState({}, '', '/cart');

      await build('PDP').fetchConfig();

      expect(fetch).toHaveBeenCalledWith(`${widgetUrl}?placement=PDP`, expect.anything());
    });

    it.each([
      ['/cart?coupon=x#top', 'CART'],
      ['/cart/', 'CART'],
      ['/checkout', 'CART'],
      ['/p/sku', 'PDP'],
      ['/de/cart', 'PDP'],
      ['/warenkorb', 'PDP'],
      ['/', 'PDP'],
    ])('should guess the placement of %s as %s when placement is not set', async (path, placement) => {
      window.history.pushState({}, '', path);

      await build().fetchConfig();

      expect(fetch).toHaveBeenCalledWith(`${widgetUrl}?placement=${placement}`, expect.anything());
    });

    it('should guess the placement for an unknown placement', async () => {
      window.history.pushState({}, '', '/checkout');

      await build('cart').fetchConfig();

      expect(fetch).toHaveBeenCalledWith(`${widgetUrl}?placement=CART`, expect.anything());
    });

    // Without custom headers the GET is a simple request, so the browser sends no CORS preflight.
    it('should send no custom headers', async () => {
      await build('PDP').fetchConfig();

      expect(fetch).toHaveBeenCalledWith(expect.any(String), { method: 'GET' });
    });
  });

  it('should return the correct HTML template for the widget', () => {
    const template = (component as any)._getTemplate('mock-webshop-id');

    expect(template).toBe('<easycredit-widget amount="100" webshop-id="mock-webshop-id" />');
  });
});
