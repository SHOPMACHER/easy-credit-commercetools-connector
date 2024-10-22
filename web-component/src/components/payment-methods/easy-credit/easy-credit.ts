import { BaseOptions } from '../../../payment-enabler/payment-enabler-mock';
import { PaymentComponent, PaymentComponentBuilder, PaymentMethod } from '../../../payment-enabler/payment-enabler';
import { BaseComponent } from '../../base';
import { findElement, importEasyCreditScript } from '../../../utils/app.utils';

export class EasyCreditCheckoutBuilder implements PaymentComponentBuilder {
  public readonly componentHasSubmit = true;

  constructor(private readonly baseOptions: BaseOptions) {}

  build(): PaymentComponent {
    return new EasyCreditCheckout(this.baseOptions);
  }
}

interface PaymentMethodSuccessResponse {
  webShopId: string;
}

interface PaymentMethodErrorResponse {
  statusCode: number;
  message: string;
  errors: {
    code: string;
    message: string;
    fields?: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [key: string]: any;
    };
  }[];
}

export class EasyCreditCheckout extends BaseComponent {
  constructor(public readonly baseOptions: BaseOptions) {
    super(PaymentMethod.easycredit, baseOptions);
  }

  async mount(selector: string): Promise<void> {
    importEasyCreditScript();

    const response = await this.getPaymentMethod();
    if (!response) {
      throw new Error('Failed to retrieve payment method.');
    }

    const template = this.generateTemplate(response);
    findElement(selector).insertAdjacentHTML('afterbegin', template);
  }

  async submit(): Promise<void> {
    // Intentionally left blank for future functionality.
  }

  public async getPaymentMethod(): Promise<PaymentMethodResponse> {
    const { processorUrl, cartId, sessionId } = this.baseOptions;

    const res = await fetch(`${processorUrl}/payments/payment-method/${cartId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId,
      },
    });

    return res.json();
  }

  private generateTemplate(response: PaymentMethodSuccessResponse | PaymentMethodErrorResponse): string {
    const errorMessages: string[] = [];
    let webShopId: string = '';

    if ('errors' in response) {
      webShopId = response.errors[0]?.fields?.webShopId;

      response.errors.forEach((error) => {
        errorMessages.push(error.message);
      });
    } else {
      webShopId = response.webShopId;
    }

    if (!webShopId) {
      throw new Error('Invalid WebShopId received.');
    }

    const errorMessage = errorMessages.join(' ').trim();

    return `
      <easycredit-checkout 
        amount="${this.baseOptions.amount}" 
        webshop-id="${webShopId}" 
        is-active="true" 
        payment-type="INSTALLMENT" 
        alert="${errorMessage}" 
      />
    `;
  }
}
