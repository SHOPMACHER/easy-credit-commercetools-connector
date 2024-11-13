/**
 * Usage:
 *    const webComponent = new WebComponent({
 *      processorUrl: __PROCESSOR_URL__,
 *      sessionId: sessionId,
 *    });
 *
 *    webComponent.createCheckoutBuilder()
 *      .then(builder => {
 *          const checkoutElement = builder.build({
 *            cartId: "be1366b5-ed5c-41f0-882f-3251413411a1",
 *            redirectLinks: {
 *                urlSuccess: "https://google.com",
 *                urlCancellation: "https://google.com",
 *                urlDenial: "https://google.com"
 *            },
 *            customerRelationship": {
 *                customerStatus: "NEW_CUSTOMER",
 *                customerSince: "2024-01-01",
 *                numberOfOrders: 0
 *            },
 *            onLoading: () => {},
 *            onError: (error) => {},
 *            onSuccess: (response) => {},
 *          });
 *          checkoutElement.mount('#checkout-component')
 *    });
 *
 *    webComponent.createSummaryBuilder()
 *      .then(builder => {
 *          const summaryElement = builder.build({
 *            paymentId: "be1366b5-ed5c-41f0-882f-3251413411a1",
 *          });
 *          checkoutElement.mount('#summary-component')
 *    });
 *
 *    webComponent.createWidgetBuilder()
 *      .then(builder => {
 *          const widgetElement = builder.build({
 *            amount: 100,
 *          });
 *          widgetElement.mount('#widget-component')
 *    });
 */
export interface WebComponent {
  createCheckoutBuilder: () => Promise<CheckoutComponentBuilder>;

  createSummaryBuilder: () => Promise<SummaryComponentBuilder>;

  createWidgetBuilder: () => Promise<WidgetComponentBuilder>;

  createLabelBuilder: () => Promise<LabelComponentBuilder>;
}

export interface CheckoutComponent {
  mount(selector: string): void;

  submit(): void;
}

export interface SummaryComponent {
  mount(selector: string): void;
}

export interface CheckoutComponentBuilder {
  build(options: CheckoutComponentOptions): CheckoutComponent;
}

export interface SummaryComponentBuilder {
  build(options: SummaryComponentOptions): SummaryComponent;
}

export interface WidgetComponent {
  mount(selector: string): void;
}

export interface WidgetComponentBuilder {
  build(options: WidgetComponentOptions): WidgetComponent;
}

export interface LabelComponent {
  mount(selector: string): void;
}

export interface LabelComponentBuilder {
  build(): LabelComponent;
}

export type WebComponentOptions = {
  processorUrl: string;

  sessionId: string;
};

export type CreatePaymentResponse = {
  technicalTransactionId: string;
  paymentId: string;
  redirectUrl: string;
  transactionInformation: {
    status: string;
    decision: {
      decisionOutcome: string;
      decisionOutcomeText: string;
    };
  };
};

export type CheckoutComponentOptions = {
  cartId: string;
  redirectLinks: {
    urlSuccess: string;
    urlCancellation: string;
    urlDenial: string;
  };
  customerRelationship: {
    customerStatus: 'NEW_CUSTOMER' | 'EXISTING_CUSTOMER' | 'PREMIUM_CUSTOMER';
    customerSince?: string;
    numberOfOrders: number;
  };
  onLoading?: () => void;
  onError: (error: Error) => void;
  onSuccess: (response: CreatePaymentResponse) => void;
};

export type SummaryComponentOptions = {
  paymentId: string;
};

export type WidgetComponentOptions = {
  amount: number;
};

import { ECWebComponent } from './ec-web-component';

export const Enabler: typeof ECWebComponent;
