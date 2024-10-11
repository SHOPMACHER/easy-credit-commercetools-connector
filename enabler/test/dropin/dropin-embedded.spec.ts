/**
 * @jest-environment jsdom
 */

import { DropinEmbeddedBuilder, PdpWidgetComponent } from '../../src/dropin/dropin-embedded';
import { BaseOptions } from '../../src/payment-enabler/payment-enabler-mock';
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

describe('DropinEmbeddedBuilder', () => {
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

  test('should correctly configure dropin options and return a PdpWidgetComponent instance', () => {
    const builder = new DropinEmbeddedBuilder(mockBaseOptions);
    const dropin = builder.build();

    expect(dropin).toBeInstanceOf(PdpWidgetComponent);

    const pdpWidgetComponent = dropin as PdpWidgetComponent;
    expect(pdpWidgetComponent.dropinOptions).toEqual({
      onDropinReady: mockBaseOptions.onDropinReady,
      onPayButtonClick: mockBaseOptions.onPayButtonClick,
      amount: mockBaseOptions.amount,
      sessionId: mockBaseOptions.sessionId,
    });
    expect(pdpWidgetComponent.processorUrl).toBe(mockBaseOptions.processorUrl);
    expect(pdpWidgetComponent.dropinOptions.amount).toBe(mockBaseOptions.amount);
  });

  test('should call onDropinReady when initialized', () => {
    const builder = new DropinEmbeddedBuilder(mockBaseOptions);
    const dropin = builder.build();

    expect(dropin).toBeInstanceOf(PdpWidgetComponent);

    (dropin as PdpWidgetComponent).init();

    expect(mockBaseOptions.onDropinReady).toHaveBeenCalled();
  });
});

describe('PdpWidgetComponent', () => {
  let dropinOptionsMock;
  let component: PdpWidgetComponent;

  beforeEach(() => {
    dropinOptionsMock = {
      howPayButton: true,
      onDropinReady: jest.fn(),
      onPayButtonClick: jest.fn(),
      amount: 100,
    };

    component = new PdpWidgetComponent({
      dropinOptions: dropinOptionsMock,
      processorUrl: 'https://test-processor-url.com',
    });
  });

  test('should call onDropinReady when init is called', () => {
    component.init();

    expect(dropinOptionsMock.onDropinReady).toHaveBeenCalled();
  });

  test('should insert the widget template when mounting and widget is enabled', async () => {
    const mockConfig = { isEnabled: true, webShopId: '123' };
    jest.spyOn(component, 'fetchConfig').mockResolvedValue(mockConfig);

    document.body.innerHTML = '<div id="widget"></div>';

    await component.mount('#widget');

    expect(document.querySelector('#widget')?.innerHTML).toContain(
      '<easycredit-widget amount="100" webshop-id="123"></easycredit-widget>',
    );
  });

  test('should not insert the widget if widget is not enabled', async () => {
    const mockConfig = { isEnabled: false, webShopId: '123' };
    jest.spyOn(component, 'fetchConfig').mockResolvedValue(mockConfig);
    document.body.innerHTML = '<div id="widget"></div>';

    await component.mount('#widget');

    expect(document.querySelector('#widget')?.innerHTML).toBe('');
  });

  test('should fetch configuration from the correct URL', async () => {
    // @ts-expect-error Expect error on document
    global.fetch = jest.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ isEnabled: true, webShopId: '123' }),
      }),
    ) as jest.Mock;

    const config = await component.fetchConfig();

    expect(fetch).toHaveBeenCalledWith('https://test-processor-url.com/operations/widget-enabled', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': undefined,
      },
    });
    expect(config).toEqual({ isEnabled: true, webShopId: '123' });
  });
});
