import {
  PaymentType,
  SummaryComponent,
  SummaryComponentBuilder,
  SummaryComponentOptions,
  WebComponentOptions,
} from '../types/main';
import { findElement, importEasyCreditScript } from '../utils/app.utils.ts';
import { DEFAULT_PAYMENT_TYPE, toWebComponentPaymentType } from '../utils/payment-type.utils.ts';

const NEGATIVE_DECISION_MESSAGES: Record<PaymentType, string> = {
  INSTALLMENT_PAYMENT: 'Es ist ein Fehler aufgetreten. Es konnte keine Ratenauswahl gefunden werden.',
  BILL_PAYMENT: 'Es ist ein Fehler aufgetreten. Die Zahlung per Rechnung ist nicht möglich.',
};

export class ECSummaryComponentBuilder implements SummaryComponentBuilder {
  constructor(private readonly baseOptions: WebComponentOptions) {}

  build(summaryComponentOptions: SummaryComponentOptions): ECSummaryComponent {
    return new ECSummaryComponent({
      processorUrl: this.baseOptions.processorUrl,
      sessionId: this.baseOptions.sessionId,
      summaryComponentOptions,
    });
  }
}

interface PaymentSuccessResponse {
  webShopId: string;
  amount: number;
  status: string;
  // Older processors omit it, their payments are always installment.
  paymentType?: PaymentType;
  decision: {
    interest: number;
    totalValue: number;
    orderValue: number;
    decisionOutcome: string;
    numberOfInstallments: number;
    installment: number;
    lastInstallment: number;
    mtan: {
      required: boolean;
      successful: boolean;
    };
    bankAccountCheck: {
      required: boolean;
    };
  };
}

interface PaymentErrorResponse {
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

export class ECSummaryComponent implements SummaryComponent {
  private readonly summaryComponentOptions: SummaryComponentOptions;

  private readonly processorUrl: string;

  private readonly sessionId: string;

  constructor(opts: { processorUrl: string; sessionId: string; summaryComponentOptions: SummaryComponentOptions }) {
    this.processorUrl = opts.processorUrl;
    this.sessionId = opts.sessionId;
    this.summaryComponentOptions = opts.summaryComponentOptions;
  }

  async mount(selector: string): Promise<void> {
    importEasyCreditScript();

    const response = await this.getPayment();
    const paymentType = ('errors' in response ? undefined : response.paymentType) ?? DEFAULT_PAYMENT_TYPE;

    findElement(selector).insertAdjacentHTML('beforeend', this.generateLabel(paymentType));
    findElement(selector).insertAdjacentHTML('beforeend', this.generateWidget(response, paymentType));
  }

  private async getPayment(): Promise<PaymentSuccessResponse | PaymentErrorResponse> {
    const res = await fetch(`${this.processorUrl}/payments/${this.summaryComponentOptions.paymentId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': this.sessionId,
      },
    });

    return res.json();
  }

  private generateLabel(paymentType: PaymentType): string {
    return `<easycredit-checkout-label payment-type="${toWebComponentPaymentType(paymentType)}" />`;
  }

  private generateWidget(response: PaymentSuccessResponse | PaymentErrorResponse, paymentType: PaymentType): string {
    const errorMessages: string[] = [];
    let amount: number = 0;
    let webShopId: string = '';
    let paymentPlan: string = '';

    if ('errors' in response) {
      response.errors.forEach((error) => {
        errorMessages.push(error.message);
      });
    } else {
      amount = response.amount;
      webShopId = response.webShopId;
      if (response.decision.decisionOutcome === 'NEGATIVE') {
        errorMessages.push(NEGATIVE_DECISION_MESSAGES[paymentType]);
      } else {
        paymentPlan = JSON.stringify(response.decision).replace(/"/g, '&quot;');
      }
    }

    const errorMessage = errorMessages.join(' ').trim();

    return `
      <easycredit-checkout 
        webshop-id="${webShopId}" 
        amount="${amount}"
        payment-plan="${paymentPlan}"
        is-active="true" 
        payment-type="${toWebComponentPaymentType(paymentType)}" 
        alert="${errorMessage}" 
      />
    `;
  }
}
