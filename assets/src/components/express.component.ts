import {
  CreatePaymentResponse,
  ExpressButtonComponent,
  ExpressButtonComponentBuilder,
  ExpressButtonComponentOptions,
  PaymentType,
  WebComponentOptions,
} from '../types/main';
import { findElement, importEasyCreditScript } from '../utils/app.utils.ts';
import { fromWebComponentPaymentType, isPaymentType, toWebComponentPaymentType } from '../utils/payment-type.utils.ts';

type ExpressConfig = {
  webShopId?: string;
  paymentTypes?: unknown[];
  // Older processors send neither, so the button stays hidden.
  expressButtonEnabled?: boolean;
  expressButtonVisibility?: 'PDP_AND_CART' | 'PDP' | 'CART';
};

// Mount count per container: only the latest mount of a container may change its button.
const latestMount = new WeakMap<Element, number>();

export class ECExpressButtonComponentBuilder implements ExpressButtonComponentBuilder {
  constructor(private readonly baseOptions: WebComponentOptions) {}

  build(options: ExpressButtonComponentOptions): ECExpressButtonComponent {
    return new ECExpressButtonComponent({
      processorUrl: this.baseOptions.processorUrl,
      sessionId: this.baseOptions.sessionId,
      options,
    });
  }
}

export class ECExpressButtonComponent implements ExpressButtonComponent {
  private readonly options: ExpressButtonComponentOptions;

  private readonly processorUrl: string;

  private readonly sessionId: string;

  private submitting = false;

  constructor(opts: { processorUrl: string; sessionId: string; options: ExpressButtonComponentOptions }) {
    this.processorUrl = opts.processorUrl;
    this.sessionId = opts.sessionId;
    this.options = opts.options;
  }

  async mount(selector: string): Promise<boolean> {
    let element: Element | undefined;
    let token = 0;
    // Replaces the container's button, or clears it when button is undefined. A mount that a later mount
    // of the same container has overtaken leaves the DOM alone, so a slow, stale mount cannot win.
    const render = (button?: HTMLElement): boolean => {
      if (!element || latestMount.get(element) !== token) {
        return false;
      }
      element.querySelectorAll('easycredit-express-button').forEach((old) => old.remove());
      if (button) {
        element.append(button);
      }

      return button !== undefined;
    };

    try {
      element = findElement(selector);
      token = (latestMount.get(element) ?? 0) + 1;
      latestMount.set(element, token);

      if (!Number.isFinite(this.options.amount)) {
        return render();
      }

      // The widget switch (isEnabled) does not apply to the express button.
      const config: ExpressConfig = await this.get('/operations/widget-enabled').then((res) => res.json());
      const visible = [this.options.placement, 'PDP_AND_CART'].includes(config.expressButtonVisibility ?? '');

      if (config.expressButtonEnabled !== true || !visible || !config.webShopId) {
        return render();
      }

      let paymentTypes = (config.paymentTypes ?? []).filter(isPaymentType);
      if (this.options.placement === 'CART') {
        paymentTypes = await this.filterByCart(paymentTypes);
      }

      // An empty payment-types attribute makes the web component fall back to installment.
      if (paymentTypes.length === 0) {
        return render();
      }

      importEasyCreditScript();
      // No redirect-url: with it, the web component opens an iframe and never fires easycredit-submit.
      const button = document.createElement('easycredit-express-button');
      button.setAttribute('webshop-id', config.webShopId);
      button.setAttribute('amount', String(this.options.amount));
      button.setAttribute('payment-types', paymentTypes.map(toWebComponentPaymentType).join(','));
      // The event is composed and bubbles, but listening on the element keeps it scoped to this button.
      // The component also fires a deprecated "submit" with the same detail, which must not post twice.
      button.addEventListener('easycredit-submit', (event) => this.submit((event as CustomEvent).detail));

      // Shops remount on amount or cart changes: replace the old button, so no second one or listener remains.
      return render(button);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to get EasyCredit Express Button', error);

      return render();
    }
  }

  private async submit(detail: { paymentType: 'INSTALLMENT' | 'BILL' }): Promise<void> {
    // A second click while the first is still running would start a second express attempt.
    if (this.submitting) {
      return;
    }
    this.submitting = true;

    try {
      this.options.onLoading?.();

      const paymentType = fromWebComponentPaymentType(detail?.paymentType);
      if (!paymentType) {
        throw new Error(`Unknown easyCredit express payment type "${String(detail?.paymentType)}".`);
      }

      const sessionId = this.options.prepareCart ? await this.options.prepareCart() : this.sessionId;

      const res = await fetch(`${this.processorUrl}/payments/express`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
        body: JSON.stringify({ paymentType, redirectLinks: this.options.redirectLinks }),
      });

      if (!res.ok) {
        // A gateway 502/504 answers with HTML: pass the status instead of a SyntaxError.
        this.options.onError(await res.json().catch(() => ({ statusCode: res.status })));
      } else {
        this.options.onSuccess((await res.json()) as CreatePaymentResponse);
      }
    } catch (error) {
      this.options.onError(error);
    } finally {
      this.submitting = false;
    }
  }

  // Keeps a type only on a 200: the express payment-method check says to hide the button on any error.
  private async filterByCart(paymentTypes: PaymentType[]): Promise<PaymentType[]> {
    const allowed = await Promise.all(
      paymentTypes.map((paymentType) =>
        this.get(`/payments/express/payment-method?${new URLSearchParams({ paymentType })}`).then(
          (res) => res.status === 200,
          () => false,
        ),
      ),
    );

    return paymentTypes.filter((_, index) => allowed[index]);
  }

  private get(path: string): Promise<Response> {
    return fetch(`${this.processorUrl}${path}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': this.sessionId },
    });
  }
}
