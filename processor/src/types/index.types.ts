export type ConnectorEnvVars = {
  commerceTools: {
    clientId: string;
    clientSecret: string;
    projectKey: string;
    scope: string;
    region: string;
  };
  easyCredit: {
    widgetEnabled: string;
    webShopId: string;
    apiPassword: string;
    debug: string;
  };
};

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
