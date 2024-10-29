import { ECWebComponent } from '../src/ec-web-component';
import { ECCheckoutComponentBuilder } from '../src/components/checkout.component';
import { ECWidgetComponentBuilder } from '../src/components/widget.component';
import { WebComponentOptions } from '../src/types/web-component.types';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { ECSummaryComponentBuilder } from '../src/components/summary.component.ts';

describe('ECWebComponent', () => {
  const mockOptions: WebComponentOptions = {
    processorUrl: 'https://example.com',
    sessionId: 'session-id-123',
  };

  let ecWebComponent: ECWebComponent;

  beforeEach(() => {
    ecWebComponent = new ECWebComponent(mockOptions);
  });

  it('should initialize with provided options', async () => {
    const setupData = await ecWebComponent.setupData;

    expect(setupData).toEqual({
      baseOptions: {
        processorUrl: mockOptions.processorUrl,
        sessionId: mockOptions.sessionId,
      },
    });
  });

  it('should create an instance of ECCheckoutComponentBuilder', async () => {
    const checkoutBuilder = await ecWebComponent.createCheckoutBuilder();

    expect(checkoutBuilder).toBeInstanceOf(ECCheckoutComponentBuilder);
  });

  it('should pass the correct options to ECCheckoutComponentBuilder', async () => {
    const checkoutBuilder = await ecWebComponent.createCheckoutBuilder();
    const baseOptions = await ecWebComponent.setupData;

    expect((checkoutBuilder as ECCheckoutComponentBuilder)['baseOptions']).toEqual(baseOptions.baseOptions);
  });

  it('should create an instance of ECSummaryComponentBuilder', async () => {
    const summaryBuilder = await ecWebComponent.createSummaryBuilder();

    expect(summaryBuilder).toBeInstanceOf(ECSummaryComponentBuilder);
  });

  it('should pass the correct options to ECSummaryComponentBuilder', async () => {
    const summaryBuilder = await ecWebComponent.createSummaryBuilder();
    const baseOptions = await ecWebComponent.setupData;

    expect((summaryBuilder as ECSummaryComponentBuilder)['baseOptions']).toEqual(baseOptions.baseOptions);
  });

  it('should create an instance of ECWidgetComponentBuilder', async () => {
    const widgetBuilder = await ecWebComponent.createWidgetBuilder();

    expect(widgetBuilder).toBeInstanceOf(ECWidgetComponentBuilder);
  });

  it('should pass the correct options to ECWidgetComponentBuilder', async () => {
    const widgetBuilder = await ecWebComponent.createWidgetBuilder();
    const baseOptions = await ecWebComponent.setupData;

    expect((widgetBuilder as ECWidgetComponentBuilder)['baseOptions']).toEqual(baseOptions.baseOptions);
  });
});
