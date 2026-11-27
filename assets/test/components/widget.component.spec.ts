/* eslint-disable no-global-assign */
import { findElement, importEasyCreditScript } from '../../src/utils/app.utils';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ECWidgetComponent, ECWidgetComponentBuilder } from '../../src/components/widget.component';

// Mocking utilities and global objects
jest.mock('../../src/utils/app.utils');
// @ts-expect-error: Mock fetch globally
fetch = jest.fn() as jest.Mock;

// Mock data
const mockWebComponentOptions = {
  processorUrl: 'https://test-processor-url.com',
  sessionId: 'mock-session-id',
};

const mockWidgetComponentOptions = {
  amount: 100,
};

const mockWidgetConfigEnabled = {
  isEnabled: true,
  webShopId: 'mock-webshop-id',
};

const mockWidgetConfigDisabled = {
  isEnabled: false,
};

describe('ECWidgetComponentBuilder', () => {
  it('should build an ECWidgetComponent', () => {
    const builder = new ECWidgetComponentBuilder(mockWebComponentOptions);
    const component = builder.build(mockWidgetComponentOptions);

    expect(component).toBeInstanceOf(ECWidgetComponent);

    expect((component as any).processorUrl).toBe(mockWebComponentOptions.processorUrl);
  });
});

describe('ECWidgetComponent', () => {
  let component: ECWidgetComponent;

  beforeEach(() => {
    component = new ECWidgetComponent({
      processorUrl: mockWebComponentOptions.processorUrl,
      widgetComponentOptions: mockWidgetComponentOptions,
    });

    jest.clearAllMocks();
  });

  it('should mount the widget when enabled', async () => {
    (importEasyCreditScript as jest.Mock).mockImplementation(() => {});
    (findElement as jest.Mock).mockReturnValue({
      insertAdjacentHTML: jest.fn(),
    });

    (fetch as jest.Mock).mockImplementation(async () =>
      Promise.resolve({
        ok: true,
        // @ts-expect-error test
        json: jest.fn().mockResolvedValueOnce(mockWidgetConfigEnabled),
      }),
    );

    await component.mount('#widget-element');

    expect(fetch).toHaveBeenCalledWith(
      `${mockWebComponentOptions.processorUrl}/operations/widget-enabled?placement=PDP`,
      expect.anything(),
    );
    expect(importEasyCreditScript).toHaveBeenCalled();
    expect(findElement).toHaveBeenCalledWith('#widget-element');
    expect(findElement('#widget-element').insertAdjacentHTML).toHaveBeenCalledWith(
      'afterbegin',
      expect.stringContaining('<easycredit-widget amount="100" webshop-id="mock-webshop-id" />'),
    );
  });

  it.each([
    [['INSTALLMENT_PAYMENT', 'BILL_PAYMENT'], ' payment-types="INSTALLMENT,BILL"'],
    [['BILL_PAYMENT'], ' payment-types="BILL"'],
    [['INSTALLMENT_PAYMENT', 'UNKNOWN'], ' payment-types="INSTALLMENT"'],
    [undefined, ''],
  ])('should render payment-types for %j', async (paymentTypes, attribute) => {
    (findElement as jest.Mock).mockReturnValue({ insertAdjacentHTML: jest.fn() });
    (fetch as jest.Mock).mockImplementation(async () =>
      Promise.resolve({
        ok: true,
        // @ts-expect-error test
        json: jest.fn().mockResolvedValueOnce({ ...mockWidgetConfigEnabled, paymentTypes }),
      }),
    );

    await component.mount('#widget-element');

    expect(findElement('#widget-element').insertAdjacentHTML).toHaveBeenCalledWith(
      'afterbegin',
      `<easycredit-widget amount="100" webshop-id="mock-webshop-id"${attribute} />`,
    );
  });

  it.each([[[]], [['UNKNOWN']]])(
    'should not mount the widget when checkout offers no known payment type (%j)',
    async (paymentTypes) => {
      (fetch as jest.Mock).mockImplementation(async () =>
        Promise.resolve({
          ok: true,
          // @ts-expect-error test
          json: jest.fn().mockResolvedValueOnce({ ...mockWidgetConfigEnabled, paymentTypes }),
        }),
      );

      await component.mount('#widget-element');

      expect(importEasyCreditScript).not.toHaveBeenCalled();
      expect(findElement).not.toHaveBeenCalled();
    },
  );

  it('should not mount the widget if it is disabled', async () => {
    (fetch as jest.Mock).mockImplementation(async () =>
      Promise.resolve({
        ok: true,
        // @ts-expect-error test
        json: jest.fn().mockResolvedValueOnce(mockWidgetConfigDisabled),
      }),
    );

    await component.mount('#widget-element');

    expect(importEasyCreditScript).not.toHaveBeenCalled();
    expect(findElement).not.toHaveBeenCalled();
  });

  it('should log an error if fetchConfig fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    (fetch as jest.Mock).mockImplementation(async () => Promise.reject(new Error('Failed to fetch')));

    await component.mount('#widget-element');

    expect(consoleSpy).toHaveBeenCalledWith('Failed to get EasyCredit Widget', expect.any(Error));

    consoleSpy.mockRestore();
  });

  it('should fetch the widget configuration successfully', async () => {
    (fetch as jest.Mock).mockImplementation(async () =>
      Promise.resolve({
        ok: true,
        // @ts-expect-error test
        json: jest.fn().mockResolvedValueOnce(mockWidgetConfigEnabled),
      }),
    );

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
