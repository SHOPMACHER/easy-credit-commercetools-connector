/* eslint-disable no-global-assign */
import { findElement, importEasyCreditScript } from '../../src/utils/app.utils';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
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

    expect((component as any).sessionId).toBe(mockWebComponentOptions.sessionId);
  });
});

describe('ECWidgetComponent', () => {
  let component: ECWidgetComponent;

  beforeEach(() => {
    component = new ECWidgetComponent({
      processorUrl: mockWebComponentOptions.processorUrl,
      sessionId: mockWebComponentOptions.sessionId,
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
      `${mockWebComponentOptions.processorUrl}/operations/widget-enabled`,
      expect.anything(),
    );
    expect(importEasyCreditScript).toHaveBeenCalled();
    expect(findElement).toHaveBeenCalledWith('#widget-element');
    expect(findElement('#widget-element').insertAdjacentHTML).toHaveBeenCalledWith(
      'afterbegin',
      expect.stringContaining('<easycredit-widget amount="100" webshop-id="mock-webshop-id" />'),
    );
  });

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

  it('should return the correct HTML template for the widget', () => {
    const template = (component as any)._getTemplate('mock-webshop-id');

    expect(template).toBe('<easycredit-widget amount="100" webshop-id="mock-webshop-id" />');
  });
});
