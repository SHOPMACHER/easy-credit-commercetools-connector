import {
  DropinComponent,
  DropinOptions,
  PaymentDropinBuilder,
} from "../payment-enabler/payment-enabler";
import { BaseOptions } from "../payment-enabler/payment-enabler-mock";

export class DropinEmbeddedBuilder implements PaymentDropinBuilder {
  public dropinHasSubmit = false;

  private config: BaseOptions;

  constructor(_baseOptions: BaseOptions) {
    this.config = _baseOptions;
  }

  build(): DropinComponent {
    const dropinOptions = {
      onDropinReady: this.config?.onDropinReady,
      onPayButtonClick: this.config?.onPayButtonClick,
    }

    const dropin = new PdpWidgetComponent({
      dropinOptions: dropinOptions,
      processorUrl: this.config?.processorUrl,
      amount: this.config?.amount
    });

    dropin.init();
    return dropin;
  }
}

export class PdpWidgetComponent implements DropinComponent {
  public dropinOptions: DropinOptions;
  public processorUrl: string;
  public amount: number;

  constructor(opts: { dropinOptions: DropinOptions, processorUrl: string, amount: number }) {
    this.dropinOptions = opts.dropinOptions;
    this.processorUrl = opts.processorUrl;
    this.amount = opts.amount;
  }

  init(): void {
    this.dropinOptions.onDropinReady?.();
  }

  async mount(selector: string) {
    const widgetConfig = await this.fetchConfig();

    if (widgetConfig.isEnabled === true) {
      document
      .querySelector(selector)
      .insertAdjacentHTML("afterbegin", this._getTemplate(widgetConfig.webShopId));
    }
  }

  public async fetchConfig() {
    const res = await fetch(
      `${this.processorUrl}/operations/widget-enabled`,
      {
          method: "GET",
      }
    );

    return await res.json();
  }

  private _getTemplate(webShopId) {
      return `<easycredit-widget amount="${this.amount}" webshop-id="${webShopId}" />`
  }

  submit(): void {
    return;
  }
}