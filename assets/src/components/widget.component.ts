import { findElement, importEasyCreditScript, waitForEasyCreditElement } from '../utils/app.utils';
import { AmountLimitsByType, filterByAmountLimits } from '../utils/amount-limits.utils';
import { isPaymentType, toWebComponentPaymentType } from '../utils/payment-type.utils';
import {
  PaymentType,
  WebComponentOptions,
  WidgetComponent,
  WidgetComponentBuilder,
  WidgetComponentOptions,
} from '../types/main';

// Mount count per container: only the latest mount of a container may change its widget.
const latestMount = new WeakMap<Element, number>();

// The latest mount of each container. An overtaken mount resolves with its result, so a shop can apply every result.
const latestMounting = new WeakMap<Element, Promise<boolean>>();

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

  mount(selector: string | Element): Promise<boolean> {
    let element: Element;
    try {
      element = findElement(selector);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to get EasyCredit Widget', error);

      return Promise.resolve(false);
    }
    const mounting = this.load(element);
    latestMounting.set(element, mounting);

    return mounting;
  }

  private async load(element: Element): Promise<boolean> {
    const token = (latestMount.get(element) ?? 0) + 1;
    latestMount.set(element, token);
    const isCurrent = () => latestMount.get(element) === token;
    // Only its own widgets: other content of the container stays.
    const clear = (): boolean | Promise<boolean> => {
      if (!isCurrent()) {
        return latestMounting.get(element) ?? false;
      }
      element.querySelectorAll(':scope > easycredit-widget').forEach((widget) => widget.remove());

      return false;
    };

    try {
      const { amount } = this.widgetComponentOptions;
      // Shops report 0 while the cart loads: no widget for that, and no request. Number(): plain JS shops pass strings.
      if (Number(amount) <= 0) {
        return clear();
      }

      const widgetConfig = await this.fetchConfig();

      // An empty list means checkout offers no easyCredit payment type right now. Older processors send no list.
      const paymentTypes = widgetConfig.paymentTypes
        ? filterByAmountLimits(widgetConfig.paymentTypes.filter(isPaymentType), amount, widgetConfig.amountLimits)
        : undefined;
      const offersNothing = paymentTypes?.length === 0;

      if (widgetConfig.isEnabled !== true || offersNothing) {
        return clear();
      }
      importEasyCreditScript();
      const template = document.createElement('template');
      template.innerHTML = this._getTemplate(widgetConfig.webShopId, paymentTypes);
      const widget = template.content.firstElementChild as HTMLElement;
      // Hidden until it has rendered; the old widget stays until then, so the page does not jump.
      // Not display: none, because easyCredit measures the width on render and keeps its small layout for 0 px.
      widget.style.cssText = 'visibility: hidden; height: 0; overflow: hidden;';
      element.prepend(widget);

      const state = await waitForEasyCreditElement(widget);

      if (!isCurrent()) {
        widget.remove();

        return latestMounting.get(element) ?? false;
      }
      if (state === 'failed') {
        return clear();
      }
      element.querySelectorAll(':scope > easycredit-widget').forEach((old) => {
        if (old !== widget) old.remove();
      });
      widget.removeAttribute('style');

      return true;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to get EasyCredit Widget', error);

      return clear();
    }
  }

  public async fetchConfig(): Promise<{
    isEnabled: boolean;
    webShopId: string;
    paymentTypes?: unknown[];
    amountLimits?: AmountLimitsByType;
  }> {
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
