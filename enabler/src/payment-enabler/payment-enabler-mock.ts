import {
  DropinType,
  EnablerOptions,
  PaymentComponentBuilder,
  PaymentDropinBuilder,
  PaymentEnabler,
  PaymentMethod,
  PaymentResult,
} from "./payment-enabler";
import { DropinEmbeddedBuilder } from "../dropin/dropin-embedded";
import { EasyCreditBuilder } from "../components/payment-methods/easycredit/easycredit";

declare global {
  interface ImportMeta {
    env: any;
  }
}

export type BaseOptions = {
  processorUrl: string;
  sessionId: string;
  environment: string;
  locale?: string;
  amount: number;
  cartId?: string;
  onComplete: (result: PaymentResult) => void;
  onError: (error?: any) => void;

  showPayButton?: boolean;
  onDropinReady?: () => Promise<void>;
  onPayButtonClick?: () => Promise<void>;
  [key: string]: any;
};

export class MockPaymentEnabler implements PaymentEnabler {
  setupData: Promise<{ baseOptions: BaseOptions }>;

  constructor(options: EnablerOptions) {
    this.setupData = MockPaymentEnabler._Setup(options);
  }

  private static _Setup = async (
    options: EnablerOptions
  ): Promise<{ baseOptions: BaseOptions }> => {

    console.log('setup func', options);
    const sdkOptions = {
      // environment: configJson.environment,
      environment: "test",
    };

    return Promise.resolve({
      baseOptions: {
        processorUrl: options.processorUrl,
        sessionId: options.sessionId,
        environment: sdkOptions.environment,
        onComplete: options.onComplete || (() => {}),
        onError: options.onError || (() => {}),
        amount: options?.amount,
        cartId: options?.cartId
      },
    });
  };


  async createComponentBuilder(type: string): Promise<PaymentComponentBuilder | never> {
    const { baseOptions } = await this.setupData;

    const supportedPaymentMethods ={
      easycredit: EasyCreditBuilder
    };

    if (!Object.keys(supportedPaymentMethods).includes(type)) {
      throw new Error(
        `Component type not supported: ${type}. Supported types: ${Object.keys(
          supportedPaymentMethods
        ).join(", ")}`
      );
    }

    return new supportedPaymentMethods[type](baseOptions);
  }

  async createDropinBuilder(
    type: DropinType
  ): Promise<PaymentDropinBuilder | never> {
    const { baseOptions } = await this.setupData;

    const supportedMethods = {
      embedded: DropinEmbeddedBuilder,
    };

    if (!Object.keys(supportedMethods).includes(type)) {
      throw new Error(
        `Component type not supported: ${type}. Supported types: ${Object.keys(
          supportedMethods
        ).join(", ")}`
      );
    }

    return new supportedMethods[type](baseOptions);
  }
}
