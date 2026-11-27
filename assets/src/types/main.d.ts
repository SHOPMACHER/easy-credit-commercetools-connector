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
 *            placement: "PDP", // Optional, else guessed from the page path
 *          });
 *          widgetElement.mount('#widget-component')
 *    });
 *
 *    webComponent.createExpressButtonBuilder()
 *      .then(builder => {
 *          const expressElement = builder.build({
 *            placement: "PDP",
 *            amount: 100,
 *            redirectLinks: {
 *                urlSuccess: "https://google.com",
 *                urlCancellation: "https://google.com",
 *                urlDenial: "https://google.com"
 *            },
 *            prepareCart: async () => sessionId,
 *            onLoading: () => {},
 *            onError: (error) => {},
 *            onSuccess: (response) => { window.location.href = response.redirectUrl; },
 *          });
 *          expressElement.mount('#express-component')
 *            .then(rendered => {})
 *    });
 */
export interface WebComponent {
  createCheckoutBuilder: () => Promise<CheckoutComponentBuilder>;

  createSummaryBuilder: () => Promise<SummaryComponentBuilder>;

  createWidgetBuilder: () => Promise<WidgetComponentBuilder>;

  createLabelBuilder: () => Promise<LabelComponentBuilder>;

  // Optional so that implementations written for earlier versions still compile; the supplied enabler has it.
  createExpressButtonBuilder?: () => Promise<ExpressButtonComponentBuilder>;
}

export interface CheckoutComponent {
  mount(selector: string): void;

  submit(): void;

  // Optional so that implementations written for earlier versions still compile; the supplied components have it.
  isAvailable?(): Promise<boolean>;
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
  // Resolves true when a widget shows, after it has rendered, and false when none shows. Never rejects.
  // A later mount of the same container replaces the widget; an overtaken mount resolves with its result.
  mount(selector: string | Element): Promise<boolean>;
}

export interface WidgetComponentBuilder {
  build(options: WidgetComponentOptions): WidgetComponent;
}

export interface LabelComponent {
  mount(selector: string): void;
}

export interface LabelComponentBuilder {
  build(options?: LabelComponentOptions): LabelComponent;
}

export type PaymentType = 'INSTALLMENT_PAYMENT' | 'BILL_PAYMENT';

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
  paymentType?: PaymentType;
  onLoading?: () => void;
  onError: (error: Error) => void;
  onSuccess: (response: CreatePaymentResponse) => void;
};

export type SummaryComponentOptions = {
  paymentId: string;
  paymentType?: PaymentType;
};

export type LabelComponentOptions = {
  paymentType?: PaymentType;
};

export type WidgetComponentOptions = {
  amount: number;
  // Where the widget is mounted. Optional: without it, /cart and /checkout count as CART and every other path as PDP.
  placement?: 'PDP' | 'CART';
};

export type ExpressButtonPlacement = 'PDP' | 'CART';

export type ExpressButtonError = {
  statusCode?: number;
  // Processor messages are technical, not for shoppers; only UnexpectedResponse and ExpressInitFailed carry shopper text.
  errors: { code: string; message: string }[];
  // Raw error for logging, never for display.
  cause?: unknown;
};

// The options both placements share.
export type ExpressButtonBaseOptions = {
  // EUR
  amount: number;
  redirectLinks: {
    urlSuccess: string;
    urlCancellation: string;
    urlDenial: string;
  };
  // true: the button fills the width of its container. Default: easyCredit's fixed width, centered.
  fullWidth?: boolean;
  onLoading?: () => void;
  onError: (error: ExpressButtonError) => void;
  onSuccess: (response: CreatePaymentResponse) => void;
};

// prepareCart returns the checkout session id of the prepared cart. The PDP requires it: the express payment charges
// the whole cart of the session. Without it, a PDP mount renders nothing.
// productTypeId (PDP only) lets the processor drop payment types the product type excludes.
export type ExpressButtonComponentOptions = ExpressButtonBaseOptions &
  (
    | { placement: 'PDP'; prepareCart: () => Promise<string>; productTypeId?: string }
    | { placement: 'CART'; prepareCart?: () => Promise<string> }
  );

export interface ExpressButtonComponent {
  // Resolves true when a button shows, after it has rendered, so the shop can hide the container without a second
  // lookup. Resolves false for no button, also for an amount of 0 or less. Never rejects.
  mount(selector: string | Element): Promise<boolean>;
  // PDP only: updates the amount of the mounted button without a remount. Resolves true when a button is shown.
  setAmount(amount: number): Promise<boolean>;
}

export interface ExpressButtonComponentBuilder {
  build(options: ExpressButtonComponentOptions): ExpressButtonComponent;
}

import { ECWebComponent } from './ec-web-component';

export const Enabler: typeof ECWebComponent;
