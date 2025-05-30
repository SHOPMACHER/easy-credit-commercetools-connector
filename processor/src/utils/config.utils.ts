import { ConnectorEnvVars } from '../types/index.types';
import envValidators from '../validators/env.validators';
import { getValidateMessages } from '../validators/helpers.validators';
/**
 * Read the configuration env vars
 * (Add yours accordingly)
 *
 * @returns The configuration with the correct env vars
 */
export const readConfiguration = () => {
  const envVars: ConnectorEnvVars = {
    commerceTools: {
      clientId: process.env.CTP_CLIENT_ID as string,
      clientSecret: process.env.CTP_CLIENT_SECRET as string,
      projectKey: process.env.CTP_PROJECT_KEY as string,
      scopes: process.env.CTP_SCOPES as string,
      region: process.env.CTP_REGION as string,
      sessionUrl: process.env.CTP_SESSION_URL as string,
    },
    easyCredit: {
      widgetEnabled: process.env.WIDGET_ENABLED as string,
      webShopId: process.env.WEBSHOP_ID as string,
      apiPassword: process.env.API_PASSWORD as string,
      debug: process.env.DEBUG as string,
    },
  };

  const validationErrors = getValidateMessages(envValidators, envVars);

  if (validationErrors.length) {
    throw new Error(
      'Invalid Environment Variables please check your .env file. Details: ' + JSON.stringify(validationErrors),
    );
  }

  return envVars;
};
