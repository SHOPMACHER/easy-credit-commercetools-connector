import { findElement, importEasyCreditScript } from '../utils/app.utils';
import { LabelComponent, LabelComponentBuilder, WebComponentOptions } from '../types/main';

export class ECLabelComponentBuilder implements LabelComponentBuilder {
  constructor(private readonly baseOptions: WebComponentOptions) {}

  build(): ECLabelComponent {
    return new ECLabelComponent({
      processorUrl: this.baseOptions.processorUrl,
      sessionId: this.baseOptions.sessionId,
    });
  }
}

export class ECLabelComponent implements LabelComponent {
  private readonly processorUrl: string;
  private readonly sessionId: string;

  constructor(opts: { processorUrl: string; sessionId: string }) {
    this.processorUrl = opts.processorUrl;
    this.sessionId = opts.sessionId;
  }

  async mount(selector: string) {
    try {
      const widgetConfig = await this.fetchConfig();

      if (widgetConfig.isEnabled === true) {
        importEasyCreditScript();

        const element = findElement(selector);

        if (element) {
          element.insertAdjacentHTML('afterbegin', this._getTemplate());
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to get EasyCredit label', error);
    }
  }

  public async fetchConfig() {
    const res = await fetch(`${this.processorUrl}/operations/widget-enabled`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': this.sessionId },
    });

    return await res.json();
  }

  private _getTemplate() {
    return `<easycredit-checkout-label />`;
  }
}
