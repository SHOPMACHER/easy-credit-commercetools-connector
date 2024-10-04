import {
  DropinComponent,
  DropinOptions,
  PaymentDropinBuilder,
} from "../payment-enabler/payment-enabler";
import { BaseOptions } from "../payment-enabler/payment-enabler-mock";
import { importEasyCreditScript } from "../utils/app.utils";

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
      amount: this.config.amount,
      sessionId: this.config.sessionId
    }

    const dropin = new PdpWidgetComponent({
      dropinOptions: dropinOptions,
      processorUrl: this.config?.processorUrl,
    });

    dropin.init();
    return dropin;
  }
}

export class PdpWidgetComponent implements DropinComponent {
  public dropinOptions: DropinOptions;
  public processorUrl: string;

  constructor(opts: { dropinOptions: DropinOptions, processorUrl: string }) {
    this.dropinOptions = opts.dropinOptions;
    this.processorUrl = opts.processorUrl;
  }

  init(): void {
    this.dropinOptions.onDropinReady?.();
  }

  async mount(selector: string) {
    const widgetConfig = await this.fetchConfig();

    if (widgetConfig.isEnabled === true) {
      importEasyCreditScript();

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
          headers: { 'Content-Type': 'application/json', 'X-Session-Id': this.dropinOptions.sessionId },
      }
    );

    return await res.json();
  }

  private _getTemplate(webShopId) {
    try {
      return `<easycredit-widget amount="${this.dropinOptions.amount}" webshop-id="${webShopId}" />`
    } catch (error) {
      console.log(error);

      return '';
    }
  }

  submit(): void {
    return;
  }
}