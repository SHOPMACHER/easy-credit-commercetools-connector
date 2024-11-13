import {
  WebComponentOptions,
  WebComponent,
  CheckoutComponentBuilder,
  WidgetComponentBuilder,
  SummaryComponentBuilder,
} from './types/main';
import { ECWidgetComponentBuilder } from './components/widget.component.ts';
import { ECCheckoutComponentBuilder } from './components/checkout.component.ts';
import { ECSummaryComponentBuilder } from './components/summary.component.ts';
import { ECLabelComponentBuilder } from './components/label.component.ts';

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
        processorUrl: options.processorUrl.endsWith('/') ? options.processorUrl.slice(0, -1) : options.processorUrl,
        sessionId: options.sessionId,
      },
    });
  };

  async createLabelBuilder(): Promise<ECLabelComponentBuilder> {
    const { baseOptions } = await this.setupData;

    return new ECLabelComponentBuilder(baseOptions);
  }

  async createCheckoutBuilder(): Promise<CheckoutComponentBuilder> {
    const { baseOptions } = await this.setupData;

    return new ECCheckoutComponentBuilder(baseOptions);
  }

  async createSummaryBuilder(): Promise<SummaryComponentBuilder> {
    const { baseOptions } = await this.setupData;

    return new ECSummaryComponentBuilder(baseOptions);
  }

  async createWidgetBuilder(): Promise<WidgetComponentBuilder> {
    const { baseOptions } = await this.setupData;

    return new ECWidgetComponentBuilder(baseOptions);
  }
}
