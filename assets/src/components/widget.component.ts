import { findElement, importEasyCreditScript } from '../utils/app.utils';
import {
  WebComponentOptions,
  WidgetComponent,
  WidgetComponentBuilder,
  WidgetComponentOptions,
} from '../types/web-component.types.ts';

export class ECWidgetComponentBuilder implements WidgetComponentBuilder {
  constructor(private readonly baseOptions: WebComponentOptions) {}

  build(widgetComponentOptions: WidgetComponentOptions): ECWidgetComponent {
    return new ECWidgetComponent({
      processorUrl: this.baseOptions.processorUrl,
      sessionId: this.baseOptions.sessionId,
      widgetComponentOptions,
    });
  }
}

export class ECWidgetComponent implements WidgetComponent {
  private readonly widgetComponentOptions: WidgetComponentOptions;

  private readonly processorUrl: string;

  private readonly sessionId: string;

  constructor(opts: { processorUrl: string; sessionId: string; widgetComponentOptions: WidgetComponentOptions }) {
    this.processorUrl = opts.processorUrl;
    this.sessionId = opts.sessionId;
    this.widgetComponentOptions = opts.widgetComponentOptions;
  }

  async mount(selector: string) {
    try {
      const widgetConfig = await this.fetchConfig();

      if (widgetConfig.isEnabled === true) {
        importEasyCreditScript();

        const element = findElement(selector);

        if (element) {
          element.insertAdjacentHTML('afterbegin', this._getTemplate(widgetConfig.webShopId));
        }
      }
    } catch (error) {
      console.error('Failed to get EasyCredit Widget', error);
    }
  }

  public async fetchConfig() {
    const res = await fetch(`${this.processorUrl}/operations/widget-enabled`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': this.sessionId },
    });

    return await res.json();
  }

  private _getTemplate(webShopId: string) {
    return `<easycredit-widget amount="${this.widgetComponentOptions.amount}" webshop-id="${webShopId}" />`;
  }

  submit(): void {
    return;
  }
}
