import {
  CheckoutComponent,
  CheckoutComponentBuilder,
  CheckoutComponentOptions,
  CreatePaymentResponse,
  PaymentType,
  WebComponentOptions,
} from '../types/main';
import { findElement, importEasyCreditScript } from '../utils/app.utils.ts';
import { DEFAULT_PAYMENT_TYPE, toWebComponentPaymentType } from '../utils/payment-type.utils.ts';

// Errors that mean the payment type can't be offered at all, so the option is hidden instead of showing an alert.
const UNAVAILABLE_ERROR_CODES: Record<PaymentType, string[]> = {
  INSTALLMENT_PAYMENT: ['PaymentTypeNotAvailable'],
  // Bill payment fails closed, so an easyCredit outage hides it as well.
  BILL_PAYMENT: ['PaymentTypeNotAvailable', 'InvalidAmount', 'EasyCreditUnavailable'],
};

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
      [key: string]: any;
    };
  }[];
}

export class ECCheckoutComponent implements CheckoutComponent {
  private readonly checkoutComponentOptions: CheckoutComponentOptions;

  private readonly processorUrl: string;

  private readonly sessionId: string;

  private paymentMethodResponse?: Promise<PaymentMethodSuccessResponse | PaymentMethodErrorResponse>;

  constructor(opts: { processorUrl: string; sessionId: string; checkoutComponentOptions: CheckoutComponentOptions }) {
    this.processorUrl = opts.processorUrl;
    this.sessionId = opts.sessionId;
    this.checkoutComponentOptions = opts.checkoutComponentOptions;
  }

  private get paymentType(): PaymentType {
    return this.checkoutComponentOptions.paymentType ?? DEFAULT_PAYMENT_TYPE;
  }

  async isAvailable(): Promise<boolean> {
    const request = this.getPaymentMethod();
    this.paymentMethodResponse = request;

    try {
      const response = await request;

      return Boolean(response) && this.isPaymentTypeAvailable(response);
    } catch (error: unknown) {
      if (this.paymentMethodResponse === request) {
        this.paymentMethodResponse = undefined;
      }
      throw error;
    }
  }

  async mount(selector: string): Promise<void> {
    // Consume the last availability check once; a later mount must read the cart again.
    const request = this.paymentMethodResponse ?? this.getPaymentMethod();
    this.paymentMethodResponse = undefined;
    const response = await request;
    if (!response) {
      throw new Error('Failed to retrieve payment method.');
    }

    if (!this.isPaymentTypeAvailable(response)) {
      return;
    }

    importEasyCreditScript();

    const element = findElement(selector);
    element.insertAdjacentHTML('beforeend', this.generateTemplate(response));
    // Scoped to this component's container, as installment and bill payment can be mounted on the same page.
    element.querySelector('easycredit-checkout')?.addEventListener('submit', this.submit.bind(this));
  }

  async submit(): Promise<void> {
    if (this.checkoutComponentOptions.onLoading) {
      this.checkoutComponentOptions.onLoading();
    }

    const body = {
      cartId: this.checkoutComponentOptions.cartId,
      paymentType: this.paymentType,
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

  private isPaymentTypeAvailable(response: PaymentMethodSuccessResponse | PaymentMethodErrorResponse): boolean {
    if (!('errors' in response)) {
      return true;
    }

    return !response.errors.some(({ code }) => UNAVAILABLE_ERROR_CODES[this.paymentType].includes(code));
  }

  private async getPaymentMethod(): Promise<PaymentMethodSuccessResponse | PaymentMethodErrorResponse> {
    const response = await fetch(
      `${this.processorUrl}/payments/payment-method/${this.checkoutComponentOptions.cartId}?paymentType=${this.paymentType}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': this.sessionId,
        },
      },
    );

    return response.json();
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
        payment-type="${toWebComponentPaymentType(this.paymentType)}"
        alert="${errorMessage}" 
      />
    `;
  }
}
