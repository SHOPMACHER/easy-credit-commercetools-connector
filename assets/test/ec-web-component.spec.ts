import { ECWebComponent } from '../src/ec-web-component';
import { ECCheckoutComponentBuilder } from '../src/components/checkout.component';
import { ECWidgetComponentBuilder } from '../src/components/widget.component';
import { ExpressButtonComponentOptions, WebComponentOptions } from '../src/types/main';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { ECSummaryComponentBuilder } from '../src/components/summary.component.ts';
import { ECExpressButtonComponentBuilder } from '../src/components/express.component';

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

  it('should create an ECExpressButtonComponentBuilder with the base options', async () => {
    const expressBuilder = await ecWebComponent.createExpressButtonBuilder();
    const baseOptions = await ecWebComponent.setupData;

    expect(expressBuilder).toBeInstanceOf(ECExpressButtonComponentBuilder);
    expect((expressBuilder as ECExpressButtonComponentBuilder)['baseOptions']).toEqual(baseOptions.baseOptions);
  });

  // Type-level only: `tsc` in `npm run build` checks this file, ts-jest does not.
  it('requires prepareCart on the PDP and not on the cart', () => {
    const base = {
      amount: 1,
      redirectLinks: { urlSuccess: '', urlCancellation: '', urlDenial: '' },
      onError: () => {},
      onSuccess: () => {},
    };
    // @ts-expect-error: prepareCart is required on the PDP
    const pdp: ExpressButtonComponentOptions = { ...base, placement: 'PDP' };
    const cart: ExpressButtonComponentOptions = { ...base, placement: 'CART' };

    expect([pdp, cart]).toHaveLength(2);
  });
});
