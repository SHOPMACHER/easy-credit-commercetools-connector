import {
  CreatePaymentResponse,
  ExpressButtonComponent,
  ExpressButtonComponentBuilder,
  ExpressButtonComponentOptions,
  ExpressButtonError,
  PaymentType,
  WebComponentOptions,
} from '../types/main';
import { findElement, importEasyCreditScript } from '../utils/app.utils.ts';
import { AmountLimitsByType, filterByAmountLimits } from '../utils/amount-limits.utils.ts';
import { suppressEasyCreditAlert } from '../utils/easycredit-alert.utils.ts';
import { fromWebComponentPaymentType, isPaymentType, toWebComponentPaymentType } from '../utils/payment-type.utils.ts';

type ExpressConfig = {
  webShopId?: string;
  paymentTypes?: unknown[];
  // Older processors send neither, so the button stays hidden.
  expressButtonEnabled?: boolean;
  expressButtonVisibility?: 'PDP_AND_CART' | 'PDP' | 'CART';
  amountLimits?: AmountLimitsByType;
};

const FALLBACK_MESSAGE =
  'Die Zahlung mit easyCredit konnte nicht gestartet werden. Bitte versuchen Sie es erneut oder wählen Sie eine andere Zahlungsart.';

const isProcessorError = (body: unknown): body is ExpressButtonError => {
  const errors = typeof body === 'object' && body !== null ? (body as { errors?: unknown }).errors : undefined;

  return (
    Array.isArray(errors) && errors.length > 0 && typeof (errors[0] as { code?: unknown } | null)?.code === 'string'
  );
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

  // Types last used for rendering, before amount filtering, so an amount change can re-filter them.
  private paymentTypes: PaymentType[] = [];

  private warnedMissingProductType = false;

  private warnedMissingPrepareCart = false;

  // Kept apart from the shop's options, which setAmount must not mutate.
  private amount: number;

  private selector?: string;

  private container?: Element;

  private token = 0;

  private config?: ExpressConfig;

  private button?: HTMLElement;

  private mounting?: Promise<boolean>;

  // False until the current mount has rendered: a mount can render before its promise settles.
  private rendered = false;

  constructor(opts: { processorUrl: string; sessionId: string; options: ExpressButtonComponentOptions }) {
    this.processorUrl = opts.processorUrl;
    this.sessionId = opts.sessionId;
    this.options = opts.options;
    this.amount = opts.options.amount;
  }

  mount(selector: string): Promise<boolean> {
    this.mounting = this.load(selector);

    return this.mounting;
  }

  async setAmount(amount: number): Promise<boolean> {
    // The cart button's types come from a server-side check of the cart, which an amount alone cannot redo.
    if (this.options.placement === 'CART') {
      throw new Error('EasyCredit Express Button: setAmount is for the PDP only, remount the cart button instead.');
    }
    if (!this.container || this.selector === undefined) {
      this.amount = amount;

      return false;
    }
    // Another mount of the container owns its button now.
    if (latestMount.get(this.container) !== this.token) {
      return false;
    }
    this.amount = amount;
    // setAmount waits for a running mount instead of starting a second one; the mount reads the amount when it renders.
    if (!this.rendered && this.mounting !== undefined) {
      return this.mounting;
    }
    if (!Number.isFinite(amount)) {
      return this.removeButton();
    }
    // Without a config the mount never got a usable one, so only a remount can fix that.
    if (!this.config) {
      return this.mount(this.selector);
    }

    const paymentTypes = this.shownTypes();
    if (paymentTypes.length === 0) {
      return this.removeButton();
    }
    // Always a new element: easyCredit's modal computes its total once and ignores a later amount.
    this.replaceButton(paymentTypes);

    return true;
  }

  private async load(selector: string): Promise<boolean> {
    let element: Element | undefined;
    let token = 0;
    // Only the component's latest mount of the latest-mounted container may set its state.
    const isCurrent = () => element !== undefined && this.container === element && latestMount.get(element) === token;
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
      if (isCurrent()) {
        this.button = button;
        this.rendered = true;
      }

      return button !== undefined;
    };

    try {
      element = findElement(selector);
      token = (latestMount.get(element) ?? 0) + 1;
      latestMount.set(element, token);
      this.selector = selector;
      this.container = element;
      this.token = token;
      this.rendered = false;
      this.config = undefined;

      if (!Number.isFinite(this.amount)) {
        return render();
      }

      if (this.missingPrepareCart()) {
        return render();
      }

      const config = await this.fetchConfig();
      if (!config) {
        return render();
      }

      let paymentTypes = (config.paymentTypes ?? []).filter(isPaymentType);
      if (this.options.placement === 'CART') {
        paymentTypes = await this.filterByCart(paymentTypes);
      }
      // setAmount may have changed the amount during the requests.
      if (!isCurrent() || !Number.isFinite(this.amount)) {
        return render();
      }
      this.config = config;
      this.paymentTypes = paymentTypes;
      const shown = this.shownTypes();

      // An empty payment-types attribute makes the web component fall back to installment.
      // Shops remount on cart changes: replace the old button, so no second one or listener remains.
      return render(shown.length > 0 ? this.createButton(shown) : undefined);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to get EasyCredit Express Button', error);

      return render();
    }
  }

  // Plain JS shops get no type check. Without prepareCart the PDP would charge the whole session cart.
  // setAmount remounts without a config, so log once per component, not on every variant change.
  private missingPrepareCart(): boolean {
    if (this.options.placement !== 'PDP' || typeof this.options.prepareCart === 'function') {
      return false;
    }
    if (!this.warnedMissingPrepareCart) {
      this.warnedMissingPrepareCart = true;
      // eslint-disable-next-line no-console
      console.error('EasyCredit Express Button: prepareCart is required on the PDP');
    }

    return true;
  }

  // The widget switch (isEnabled) does not apply to the express button. Undefined means: render nothing.
  private async fetchConfig(): Promise<ExpressConfig | undefined> {
    const res = await this.get(`/operations/widget-enabled${this.productTypeQuery()}`);
    if (!res.ok) {
      const hint = this.sentProductTypeId() ? ' Check that productTypeId is the product type ID (a UUID).' : '';
      // eslint-disable-next-line no-console
      console.error(`Failed to get EasyCredit Express Button config ${res.status}.${hint}`);

      return undefined;
    }
    const config: ExpressConfig = await res.json();
    const visible = [this.options.placement, 'PDP_AND_CART'].includes(config.expressButtonVisibility ?? '');

    return config.expressButtonEnabled === true && visible && config.webShopId ? config : undefined;
  }

  private sentProductTypeId(): string | undefined {
    if (this.options.placement !== 'PDP') {
      return undefined;
    }
    const { productTypeId } = this.options;

    return typeof productTypeId === 'string' && productTypeId !== '' ? productTypeId : undefined;
  }

  // PDP only: lets the processor drop the payment types that exclude the product type.
  private productTypeQuery(): string {
    if (this.options.placement !== 'PDP') {
      return '';
    }
    const productTypeId = this.sentProductTypeId();
    if (productTypeId) {
      return `?${new URLSearchParams({ productTypeId })}`;
    }
    if (!this.warnedMissingProductType) {
      this.warnedMissingProductType = true;
      // eslint-disable-next-line no-console
      console.warn('EasyCredit Express Button: productTypeId is missing, product type exclusions are not applied.');
    }

    return '';
  }

  private createButton(paymentTypes: PaymentType[]): HTMLElement {
    // Only a mount that read the config renders a button; anything else is a bug, not an empty shop id.
    if (!this.config?.webShopId) {
      throw new Error('EasyCredit Express Button: createButton called without a loaded config.');
    }
    importEasyCreditScript();
    // No redirect-url: with it, the web component opens an iframe and never fires easycredit-submit.
    const button = document.createElement('easycredit-express-button');
    button.setAttribute('webshop-id', this.config.webShopId);
    button.setAttribute('amount', String(this.amount));
    button.setAttribute('payment-types', paymentTypes.map(toWebComponentPaymentType).join(','));
    // The event is composed and bubbles, but listening on the element keeps it scoped to this button.
    // The component also fires a deprecated "submit" with the same detail, which must not post twice.
    button.addEventListener('easycredit-submit', (event) => {
      // easyCredit starts a new 10 s alert timer on every accept, also while our submit runs.
      suppressEasyCreditAlert();
      this.submit((event as CustomEvent).detail);
    });

    return button;
  }

  private replaceButton(paymentTypes: PaymentType[]): void {
    const button = this.createButton(paymentTypes);
    if (this.button) {
      this.button.replaceWith(button);
    } else {
      this.container?.append(button);
    }
    this.button = button;
  }

  private shownTypes(): PaymentType[] {
    return this.options.placement === 'PDP'
      ? filterByAmountLimits(this.paymentTypes, this.amount, this.config?.amountLimits)
      : this.paymentTypes;
  }

  private removeButton(): false {
    this.button?.remove();
    this.button = undefined;

    return false;
  }

  private async submit(detail: { paymentType: 'INSTALLMENT' | 'BILL' }): Promise<void> {
    // A second click while the first is still running would start a second express attempt.
    if (this.submitting) {
      return;
    }
    this.submitting = true;

    // The shop's onError/onSuccess run after the try: a throw there must not count as a failed click.
    let failure: ExpressButtonError | undefined;
    let payment: CreatePaymentResponse | undefined;
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
        // A gateway 502/504 answers with HTML: keep the parse error as the cause.
        const body: unknown = await res.json().catch((error: unknown) => error);
        failure = isProcessorError(body)
          ? body
          : {
              statusCode: res.status,
              errors: [{ code: 'UnexpectedResponse', message: FALLBACK_MESSAGE }],
              cause: body,
            };
      } else {
        payment = (await res.json()) as CreatePaymentResponse;
      }
    } catch (error) {
      failure = { errors: [{ code: 'ExpressInitFailed', message: FALLBACK_MESSAGE }], cause: error };
    }

    try {
      if (failure) {
        this.fail(failure);
      } else if (payment) {
        this.options.onSuccess(payment);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('easyCredit express callback threw', error);
    } finally {
      this.submitting = false;
    }
  }

  // A fresh element closes easyCredit's modal at once, so the shopper can click again. The old element's
  // 10 s alert still fires and is swallowed by suppressEasyCreditAlert.
  private fail(error: ExpressButtonError): void {
    // No config means a remount is loading and owns the DOM.
    if (this.config && this.button && this.container && latestMount.get(this.container) === this.token) {
      const shown = this.shownTypes();
      // An empty payment-types attribute makes the web component fall back to installment.
      if (shown.length === 0) {
        this.removeButton();
      } else {
        this.replaceButton(shown);
      }
    }
    this.options.onError(error);
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
