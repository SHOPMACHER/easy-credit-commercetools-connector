export const EXPRESS_BUTTON_VISIBILITIES = ['PDP_AND_CART', 'PDP', 'CART'] as const;
export type ExpressButtonVisibility = (typeof EXPRESS_BUTTON_VISIBILITIES)[number];

export type ConnectorEnvVars = {
  commerceTools: {
    clientId: string;
    clientSecret: string;
    projectKey: string;
    scopes: string;
    region: string;
    sessionUrl: string;
  };
  easyCredit: {
    widgetEnabled: string;
    widgetVisibility: WidgetVisibility;
    expressButtonEnabled: string;
    expressButtonVisibility: ExpressButtonVisibility;
    webShopId: string;
    apiPassword: string;
    debug: string;
    billPaymentEnabled: string;
    webshopCacheTtl: string;
    billPaymentExcludedProductTypes: string[];
    billPaymentExcludedCustomLineItems: string[];
    installmentPaymentEnabled: string;
    installmentPaymentExcludedProductTypes: string[];
    installmentPaymentExcludedCustomLineItems: string[];
    redirectAllowedHosts: string[];
    installmentPaymentMinAmount?: string;
    installmentPaymentMaxAmount?: string;
    billPaymentMinAmount?: string;
    billPaymentMaxAmount?: string;
  };
};

export type WidgetVisibility = 'PDP_AND_CART' | 'PDP' | 'CART';

export type Message = {
  code: string;
  message: string;
  referencedBy: string;
};

export type ValidatorCreator = (
  path: string[],
  message: Message,
  overrideConfig?: object,
) => [string[], [[(o: object) => boolean, string, [object]]]];

export type ValidatorFunction = (o: object) => boolean;

export type Wrapper = (validator: ValidatorFunction) => (value: object) => boolean;
