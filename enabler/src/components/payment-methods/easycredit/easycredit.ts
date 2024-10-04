import { BaseOptions } from '../../../payment-enabler/payment-enabler-mock';
import {
  ComponentOptions,
  PaymentComponent,
  PaymentComponentBuilder,
  PaymentMethod
} from '../../../payment-enabler/payment-enabler';
import { BaseComponent } from "../../base";
import { importEasyCreditScript } from '../../../utils/app.utils';

export class EasyCreditBuilder implements PaymentComponentBuilder {
  public componentHasSubmit = true

  constructor(private baseOptions: BaseOptions) {}

  build(config: ComponentOptions): PaymentComponent {
    return new EasyCredit(this.baseOptions, config);
  }
}

export class EasyCredit extends BaseComponent {
  private baseOptions: BaseOptions
  
  constructor(baseOptions: BaseOptions, componentOptions: ComponentOptions) {
    super(PaymentMethod.easycredit, baseOptions, componentOptions);
    this.baseOptions = baseOptions;
  }


  async mount(selector: string) {
    importEasyCreditScript();

    const response = await this.getPaymentMethod();

    if (response) {  
      document.querySelector(selector).insertAdjacentHTML("afterbegin", this._getTemplate(response));
    }
  }

  async submit() {
    return;
  }

  public async getPaymentMethod() {
    const res = await fetch(
      `${this.processorUrl}/payments/payment-method?cartId=${this.baseOptions.cartId}`,
      {
          method: "GET",
          headers: { 'Content-Type': 'application/json', 'X-Session-Id': this.baseOptions.sessionId },
      }
    );

    return await res.json();
  }

  private _getTemplate(response: any) {
    try {
      let errorMessage = '';
      if (response.errors) {
        response.errors.map((error) => {
          errorMessage += error.message + '\n';
        })
      }

      return `<easycredit-checkout amount="${this.baseOptions.amount}" webshop-id="${response.webShopId}" is-active="true" payment-type="INSTALLMENT" alert="${errorMessage}"/>`
    } catch (error) {
      console.log(error);

      return '';
    }
  }
}
