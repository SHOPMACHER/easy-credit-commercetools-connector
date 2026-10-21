import {
  CheckoutComponent,
  CheckoutComponentBuilder,
  CheckoutComponentOptions,
  CreatePaymentResponse,
  PaymentType,
  WebComponentOptions,
} from '../types/main';
import { findElement, importEasyCreditScript } from '../utils/app.utils.ts';
import { assertPaymentType, DEFAULT_PAYMENT_TYPE, toWebComponentPaymentType } from '../utils/payment-type.utils.ts';

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
  // Older processors omit it.
  paymentTypes?: Partial<Record<PaymentType, { available: boolean }>>;
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

const isErrorResponse = (
  response: PaymentMethodSuccessResponse | PaymentMethodErrorResponse,
): response is PaymentMethodErrorResponse => Array.isArray((response as PaymentMethodErrorResponse).errors);

const getWebShopId = (response: PaymentMethodSuccessResponse | PaymentMethodErrorResponse): string | undefined =>
  isErrorResponse(response) ? response.errors[0]?.fields?.webShopId : response.webShopId;

export class ECCheckoutComponent implements CheckoutComponent {
  private readonly checkoutComponentOptions: CheckoutComponentOptions;

  private readonly processorUrl: string;

  private readonly sessionId: string;

  constructor(opts: { processorUrl: string; sessionId: string; checkoutComponentOptions: CheckoutComponentOptions }) {
    assertPaymentType(opts.checkoutComponentOptions.paymentType);
    this.processorUrl = opts.processorUrl;
    this.sessionId = opts.sessionId;
    this.checkoutComponentOptions = opts.checkoutComponentOptions;
  }

  private get paymentType(): PaymentType {
    return this.checkoutComponentOptions.paymentType ?? DEFAULT_PAYMENT_TYPE;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.getPaymentMethod();

      return Boolean(response) && this.isPaymentTypeAvailable(response);
    } catch {
      // Fails closed on network errors and non-JSON bodies (e.g. a gateway 502).
      return false;
    }
  }

  async mount(selector: string): Promise<void> {
    const response = await this.getPaymentMethod();
    if (!response) {
      throw new Error('Failed to retrieve payment method.');
    }

    // Installment keeps rendering the widget with the alert, so only bill payment renders nothing.
    if (this.paymentType === 'BILL_PAYMENT' && !this.isPaymentTypeAvailable(response)) {
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

  // Fails closed: a response the widget can't be rendered from (e.g. 401 or 500 without a webShopId) is unavailable.
  private isPaymentTypeAvailable(response: PaymentMethodSuccessResponse | PaymentMethodErrorResponse): boolean {
    if (!getWebShopId(response)) {
      return false;
    }

    // An older processor ignores paymentType and answers with the installment checks, so bill needs its own flag.
    if (this.paymentType === 'BILL_PAYMENT' && !isErrorResponse(response)) {
      return response.paymentTypes?.BILL_PAYMENT?.available === true;
    }

    return (
      !isErrorResponse(response) ||
      !response.errors.some(({ code }) => UNAVAILABLE_ERROR_CODES[this.paymentType].includes(code))
    );
  }

  private async getPaymentMethod(): Promise<PaymentMethodSuccessResponse | PaymentMethodErrorResponse> {
    const cartId = encodeURIComponent(this.checkoutComponentOptions.cartId);
    const query = new URLSearchParams({ paymentType: this.paymentType });
    const response = await fetch(`${this.processorUrl}/payments/payment-method/${cartId}?${query.toString()}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': this.sessionId,
      },
    });

    return response.json();
  }

  private generateTemplate(response: PaymentMethodSuccessResponse | PaymentMethodErrorResponse): string {
    const webShopId = getWebShopId(response);
    const errorMessages = isErrorResponse(response) ? response.errors.map(({ message }) => message) : [];
    const amount = isErrorResponse(response) ? 0 : response.amount;

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
