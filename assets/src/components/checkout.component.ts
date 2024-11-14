import {
  CheckoutComponent,
  CheckoutComponentBuilder,
  CheckoutComponentOptions,
  CreatePaymentResponse,
  WebComponentOptions,
} from '../types/main';
import { findElement, importEasyCreditScript } from '../utils/app.utils.ts';

export class ECCheckoutComponentBuilder implements CheckoutComponentBuilder {
  constructor(private readonly baseOptions: WebComponentOptions) {}

  build(checkoutComponentOptions: CheckoutComponentOptions): ECCheckoutComponent {
    return new ECCheckoutComponent({
      processorUrl: this.baseOptions.processorUrl,
      sessionId: this.baseOptions.sessionId,
      checkoutComponentOptions,
    });
  }
}

interface PaymentMethodSuccessResponse {
  webShopId: string;
  amount: number;
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

export class ECCheckoutComponent implements CheckoutComponent {
  private readonly checkoutComponentOptions: CheckoutComponentOptions;

  private readonly processorUrl: string;

  private readonly sessionId: string;

  constructor(opts: { processorUrl: string; sessionId: string; checkoutComponentOptions: CheckoutComponentOptions }) {
    this.processorUrl = opts.processorUrl;
    this.sessionId = opts.sessionId;
    this.checkoutComponentOptions = opts.checkoutComponentOptions;
  }

  async mount(selector: string): Promise<void> {
    importEasyCreditScript();

    const response = await this.getPaymentMethod();
    if (!response) {
      throw new Error('Failed to retrieve payment method.');
    }

    findElement(selector).insertAdjacentHTML('beforeend', this.generateTemplate(response));
    document.querySelector('easycredit-checkout')?.addEventListener('submit', this.submit.bind(this));
  }

  async submit(): Promise<void> {
    if (this.checkoutComponentOptions.onLoading) {
      this.checkoutComponentOptions.onLoading();
    }

    const body = {
      cartId: this.checkoutComponentOptions.cartId,
      redirectLinks: this.checkoutComponentOptions.redirectLinks,
      customerRelationship: this.checkoutComponentOptions.customerRelationship,
    };

    const res = await fetch(`${this.processorUrl}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': this.sessionId,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      this.checkoutComponentOptions.onError(await res.json());
    } else {
      const response = (await res.json()) as CreatePaymentResponse;

      this.checkoutComponentOptions.onSuccess(response);
    }
  }

  private async getPaymentMethod(): Promise<PaymentMethodSuccessResponse | PaymentMethodErrorResponse> {
    const res = await fetch(`${this.processorUrl}/payments/payment-method/${this.checkoutComponentOptions.cartId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': this.sessionId,
      },
    });

    return res.json();
  }

  private generateTemplate(response: PaymentMethodSuccessResponse | PaymentMethodErrorResponse): string {
    const errorMessages: string[] = [];
    let webShopId: string = '';
    let amount: number = 0;

    if ('errors' in response) {
      webShopId = response.errors[0]?.fields?.webShopId;

      response.errors.forEach((error) => {
        errorMessages.push(error.message);
      });
    } else {
      webShopId = response.webShopId;
      amount = response.amount;
    }

    if (!webShopId) {
      throw new Error('Invalid WebShopId received.');
    }

    const errorMessage = errorMessages.join(' ').trim();

    return `
      <easycredit-checkout 
        amount="${amount}" 
        webshop-id="${webShopId}" 
        is-active="true" 
        payment-type="INSTALLMENT" 
        alert="${errorMessage}" 
      />
    `;
  }
}
