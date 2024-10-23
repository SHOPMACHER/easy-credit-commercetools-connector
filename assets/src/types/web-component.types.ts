/**
 * Usage:
 *    const webComponent = new WebComponent({
 *      processorUrl: __VITE_PROCESSOR_URL__,
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
 *            onError: (error) => {},
 *            onSuccess: (response) => {},
 *          });
 *          checkoutElement.mount('#checkout-component')
 *      })
 *
 *    webComponent.createWidgetComponentBuilder(')
 *      .then(builder => {
 *          const widgetElement = builder.build({
 *            amount: 100,
 *          });
 *          widgetElement.mount('#widget-component')
 *      })
 */
export interface WebComponent {
  createCheckoutBuilder: () => Promise<CheckoutComponentBuilder>;

  createWidgetBuilder: () => Promise<WidgetComponentBuilder>;
}

export interface CheckoutComponent {
  mount(selector: string): void;

  submit(): void;
}

export interface CheckoutComponentBuilder {
  build(options: CheckoutComponentOptions): CheckoutComponent;
}

export interface WidgetComponent {
  mount(selector: string): void;
}

export interface WidgetComponentBuilder {
  build(options: WidgetComponentOptions): WidgetComponent;
}

export type WebComponentOptions = {
  processorUrl: string;

  sessionId: string;
};

export type CreatePaymentResponse = {
  technicalTransactionId: string;
  transactionId: string;
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
    customerStatus: string;
    customerSince: string;
    numberOfOrders: number;
  };
  onError: (error: Error) => void;
  onSuccess?: (error: CreatePaymentResponse) => void;
};

export type WidgetComponentOptions = {
  amount: number;
};
