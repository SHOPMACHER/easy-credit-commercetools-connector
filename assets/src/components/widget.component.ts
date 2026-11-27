import { findElement, importEasyCreditScript } from '../utils/app.utils';
import { isPaymentType, toWebComponentPaymentType } from '../utils/payment-type.utils';
import {
  PaymentType,
  WebComponentOptions,
  WidgetComponent,
  WidgetComponentBuilder,
  WidgetComponentOptions,
} from '../types/main';

// Routes of the commercetools Frontend template.
const CART_PATHS = ['/cart', '/checkout'];

export class ECWidgetComponentBuilder implements WidgetComponentBuilder {
  constructor(private readonly baseOptions: WebComponentOptions) {}

  build(widgetComponentOptions: WidgetComponentOptions): ECWidgetComponent {
    return new ECWidgetComponent({
      processorUrl: this.baseOptions.processorUrl,
      widgetComponentOptions,
    });
  }
}

export class ECWidgetComponent implements WidgetComponent {
  private readonly widgetComponentOptions: WidgetComponentOptions;

  private readonly processorUrl: string;

  constructor(opts: { processorUrl: string; widgetComponentOptions: WidgetComponentOptions }) {
    this.processorUrl = opts.processorUrl;
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
    const res = await fetch(`${this.processorUrl}/operations/widget-enabled?placement=${this.getPlacement()}`, {
      method: 'GET',
    });

    return await res.json();
  }

  // Without placement, the widget guesses from the page path. Shops with other cart routes pass placement.
  private getPlacement(): 'PDP' | 'CART' {
    const { placement } = this.widgetComponentOptions;
    if (placement === 'PDP' || placement === 'CART') {
      return placement;
    }
    const path = window.location.pathname.replace(/(.)\/$/, '$1');
    return CART_PATHS.includes(path) ? 'CART' : 'PDP';
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
