import {
  CreatePaymentResponse,
  ExpressButtonComponent,
  ExpressButtonComponentBuilder,
  ExpressButtonComponentOptions,
  ExpressButtonError,
  PaymentType,
  WebComponentOptions,
} from '../types/main';
import { findElement, importEasyCreditScript, waitForEasyCreditElement } from '../utils/app.utils.ts';
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

// The latest mount of each container. An overtaken mount resolves with its result, so a shop can apply every result.
const latestMounting = new WeakMap<Element, Promise<boolean>>();

// A button for 0 or a negative amount would open easyCredit with an amount it rejects.
const isPayableAmount = (amount: number): boolean => Number.isFinite(amount) && amount > 0;

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

  private selector?: string | Element;

  private container?: Element;

  private token = 0;

  private config?: ExpressConfig;

  private button?: HTMLElement;

  private mounting?: Promise<boolean>;

  // False until the current mount has shown its button (or decided on none).
  private rendered = false;

  // Counts the button changes of this component: only the latest change may show its button.
  private swap = 0;

  // The amount the shown button (or the decision for none) was made for.
  private renderedAmount?: number;

  // The latest button change, so an overtaken one resolves with its result.
  private showing?: Promise<boolean>;

  constructor(opts: { processorUrl: string; sessionId: string; options: ExpressButtonComponentOptions }) {
    this.processorUrl = opts.processorUrl;
    this.sessionId = opts.sessionId;
    this.options = opts.options;
    this.amount = opts.options.amount;
  }

  mount(selector: string | Element): Promise<boolean> {
    let element: Element;
    try {
      element = findElement(selector);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to get EasyCredit Express Button', error);

      return Promise.resolve(false);
    }
    this.mounting = this.load(selector, element);
    latestMounting.set(element, this.mounting);

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
      return latestMounting.get(this.container) ?? false;
    }
    this.amount = amount;
    if (!this.rendered && this.mounting !== undefined) {
      return this.afterMount(this.container, this.mounting);
    }
    if (!isPayableAmount(amount)) {
      return this.removeButton();
    }
    // Without a config the mount never got a usable one, so only a remount can fix that.
    if (!this.config) {
      return this.mount(this.selector);
    }

    // Always a new element: easyCredit's modal computes its total once and ignores a later amount.
    return this.show(this.shownTypes());
  }

  // setAmount while a mount runs: wait for the mount instead of starting a second one.
  private async afterMount(container: Element, mounting: Promise<boolean>): Promise<boolean> {
    const shown = await mounting;
    if (latestMount.get(container) !== this.token) {
      return latestMounting.get(container) ?? false;
    }
    // The mount used the amount it had when it built the button. An amount that came later still needs a button.
    if (this.rendered && this.renderedAmount !== this.amount) {
      return this.setAmount(this.amount);
    }

    // An earlier call may already be showing the button for this amount.
    return this.showing ?? shown;
  }

  private async load(selector: string | Element, element: Element): Promise<boolean> {
    const token = (latestMount.get(element) ?? 0) + 1;
    // Only the component's latest mount of the latest-mounted container may set its state.
    const isCurrent = () => this.container === element && latestMount.get(element) === token;
    // Clears the container's button. A mount that a later mount of the same container has overtaken leaves the DOM
    // alone, so a slow, stale mount cannot win.
    const render = (): boolean | Promise<boolean> => {
      if (latestMount.get(element) !== token) {
        return latestMounting.get(element) ?? false;
      }
      element.querySelectorAll('easycredit-express-button').forEach((old) => old.remove());
      if (isCurrent()) {
        this.showing = undefined;
        this.button = undefined;
        this.rendered = true;
        this.renderedAmount = this.amount;
      }

      return false;
    };

    try {
      latestMount.set(element, token);
      this.selector = selector;
      this.container = element;
      this.token = token;
      this.rendered = false;
      this.config = undefined;

      if (!isPayableAmount(this.amount)) {
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
      if (!isCurrent() || !isPayableAmount(this.amount)) {
        return render();
      }
      this.config = config;
      this.paymentTypes = paymentTypes;

      // Shops remount on cart changes: show replaces the old button, so no second one or listener remains.
      const shown = await this.show(this.shownTypes());
      if (isCurrent()) {
        this.rendered = true;
      }

      return shown;
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
    // Set here, because mount, setAmount and a failed start all render a new element.
    if (this.options.fullWidth) button.setAttribute('full-width', 'true');
    // The event is composed and bubbles, but listening on the element keeps it scoped to this button.
    // The component also fires a deprecated "submit" with the same detail, which must not post twice.
    button.addEventListener('easycredit-submit', (event) => {
      // easyCredit starts a new 10 s alert timer on every accept, also while our submit runs.
      suppressEasyCreditAlert();
      this.submit((event as CustomEvent).detail);
    });

    return button;
  }

  // Shows a new button for the payment types, or none. The new button stays hidden, and the old one stays, until the
  // new one has rendered: the page does not jump, and the shop's promise resolves when the button is visible.
  private show(paymentTypes: PaymentType[]): Promise<boolean> {
    const { container, token } = this;
    this.swap += 1;
    const swap = this.swap;
    this.renderedAmount = this.amount;

    const showing = (async () => {
      // An empty payment-types attribute makes the web component fall back to installment.
      if (!container || paymentTypes.length === 0) {
        return this.clearButtons();
      }
      const button = this.createButton(paymentTypes);
      // Inline, because a display rule of the component's host would win over the hidden attribute.
      button.style.display = 'none';
      container.append(button);

      const state = await waitForEasyCreditElement(button);

      if (latestMount.get(container) !== token) {
        button.remove();

        return latestMounting.get(container) ?? false;
      }
      // This instance moved to another container. The latest mount of this one would be this very call.
      if (this.container !== container || this.token !== token) {
        button.remove();

        return false;
      }
      // A later button change of this mount decides what shows.
      if (this.swap !== swap) {
        button.remove();

        return this.showing ?? Boolean(this.button?.isConnected);
      }
      if (state === 'failed') {
        button.remove();

        return this.clearButtons();
      }
      container.querySelectorAll('easycredit-express-button').forEach((old) => {
        if (old !== button) old.remove();
      });
      button.style.removeProperty('display');
      this.button = button;

      return true;
    })();
    this.showing = showing;

    return showing;
  }

  private clearButtons(): false {
    this.container?.querySelectorAll('easycredit-express-button').forEach((old) => old.remove());
    this.button = undefined;

    return false;
  }

  // Swaps at once, without waiting for the render: used after a failed start, see fail().
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
    this.swap += 1;
    this.showing = undefined;
    this.renderedAmount = this.amount;

    return this.clearButtons();
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

  // A fresh element closes easyCredit's modal at once, so the shopper can click again. Thus it does not wait for the
  // render like show(). The old element's 10 s alert still fires and is swallowed by suppressEasyCreditAlert.
  private fail(error: ExpressButtonError): void {
    // No config means a remount is loading and owns the DOM.
    if (this.config && this.button && this.container && latestMount.get(this.container) === this.token) {
      // A button change that is still waiting must not replace this one.
      this.swap += 1;
      this.showing = undefined;
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
