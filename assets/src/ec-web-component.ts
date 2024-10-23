import {
  WebComponentOptions,
  WebComponent,
  CheckoutComponentBuilder,
  WidgetComponentBuilder,
} from './types/web-component.types.ts';
import { ECWidgetComponentBuilder } from './components/widget.component.ts';
import { ECCheckoutComponentBuilder } from './components/checkout.component.ts';

export class ECWebComponent implements WebComponent {
  setupData: Promise<{ baseOptions: WebComponentOptions }>;

  constructor(options: WebComponentOptions) {
    this.setupData = ECWebComponent._Setup(options);
  }

  private static readonly _Setup = async (
    options: WebComponentOptions,
  ): Promise<{ baseOptions: WebComponentOptions }> => {
    return Promise.resolve({
      baseOptions: {
        processorUrl: options.processorUrl,
        sessionId: options.sessionId,
      },
    });
  };

  async createCheckoutBuilder(): Promise<CheckoutComponentBuilder> {
    const { baseOptions } = await this.setupData;

    return new ECCheckoutComponentBuilder(baseOptions);
  }

  async createWidgetBuilder(): Promise<WidgetComponentBuilder> {
    const { baseOptions } = await this.setupData;

    return new ECWidgetComponentBuilder(baseOptions);
  }
}
