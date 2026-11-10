import { findElement, importEasyCreditScript } from '../utils/app.utils';
import { isPaymentType, toWebComponentPaymentType } from '../utils/payment-type.utils';
import {
  PaymentType,
  WebComponentOptions,
  WidgetComponent,
  WidgetComponentBuilder,
  WidgetComponentOptions,
} from '../types/main';

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

      // An empty list means checkout offers no easyCredit payment type right now. Older processors send no list.
      const paymentTypes = widgetConfig.paymentTypes?.filter(isPaymentType);
      const offersNothing = paymentTypes?.length === 0;

      if (widgetConfig.isEnabled === true && !offersNothing) {
        importEasyCreditScript();

        const element = findElement(selector);

        if (element) {
          element.insertAdjacentHTML('afterbegin', this._getTemplate(widgetConfig.webShopId, paymentTypes));
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to get EasyCredit Widget', error);
    }
  }

  public async fetchConfig(): Promise<{ isEnabled: boolean; webShopId: string; paymentTypes?: unknown[] }> {
    const res = await fetch(`${this.processorUrl}/operations/widget-enabled`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': this.sessionId },
    });

    return await res.json();
  }

  // paymentTypes comes from the processor: the types checkout offers. Older processors don't send it, and the
  // web component then falls back to installment. It must be set on render; easyCredit ignores later changes.
  private _getTemplate(webShopId: string, paymentTypes?: PaymentType[]) {
    const paymentTypesAttribute =
      paymentTypes && paymentTypes.length > 0
        ? ` payment-types="${paymentTypes.map(toWebComponentPaymentType).join(',')}"`
        : '';

    return `<easycredit-widget amount="${this.widgetComponentOptions.amount}" webshop-id="${webShopId}"${paymentTypesAttribute} />`;
  }

  submit(): void {
    return;
  }
}
