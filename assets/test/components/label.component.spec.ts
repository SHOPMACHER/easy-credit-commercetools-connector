/* eslint-disable no-global-assign */
import { ECLabelComponent, ECLabelComponentBuilder } from './../../src/components/label.component';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { findElement, importEasyCreditScript } from '../../src/utils/app.utils';

jest.mock('../../src/utils/app.utils');
// @ts-expect-error: Mock fetch globally
fetch = jest.fn() as jest.Mock;

// Mock data
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

describe('ECLabelComponentBuilder', () => {
  it('should build ECLabelComponent', () => {
    const builder = new ECLabelComponentBuilder(mockWebComponentOptions);
    const component = builder.build();

    expect(component).toBeInstanceOf(ECLabelComponent);

    expect((component as any).processorUrl).toBe(mockWebComponentOptions.processorUrl);

    expect((component as any).sessionId).toBe(mockWebComponentOptions.sessionId);
  });
});

describe('ECLabelComponent', () => {
  let component: ECLabelComponent;

  beforeEach(() => {
    component = new ECLabelComponent({
      processorUrl: mockWebComponentOptions.processorUrl,
      sessionId: mockWebComponentOptions.sessionId,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should mount the label component when enabled', async () => {
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
      '<easycredit-checkout-label />',
    );
  });

  it('should not mount the label component if it is disabled', async () => {
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

  it('should log an error when fetching the config fails', async () => {
    (fetch as jest.Mock).mockImplementation(async () => {
      throw new Error('Failed to fetch config');
    });

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await component.mount('#widget-element');

    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to get EasyCredit label', expect.any(Error));

    consoleErrorSpy.mockRestore();
  });
});
