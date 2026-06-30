import { Logger, RequestContextData, setupPaymentSDK } from '@commercetools/connect-payments-sdk';
import { getRequestContext, updateRequestContext } from './libs/fastify/context/context';
import { log } from './libs/logger/index';

export class AppLogger implements Logger {
  public debug = (obj: object, message: string) => {
    log.debug(message, obj || undefined);
  };
  public info = (obj: object, message: string) => {
    log.info(message, obj || undefined);
  };
  public warn = (obj: object, message: string) => {
    log.warn(message, obj || undefined);
  };
  public error = (obj: object, message: string) => {
    log.error(message, obj || undefined);
  };
}

export const appLogger = new AppLogger();

const getCheckoutUrl = (): string => {
  if (process.env.CTP_CHECKOUT_URL) {
    return process.env.CTP_CHECKOUT_URL;
  }
  const sessionUrl = process.env.CTP_SESSION_URL ?? '';
  return sessionUrl.replace('://session.', '://checkout.');
};

export const paymentSDK = setupPaymentSDK({
  apiUrl: process.env.CTP_API_URL as string,
  authUrl: process.env.CTP_AUTH_URL as string,
  clientId: process.env.CTP_CLIENT_ID as string,
  clientSecret: process.env.CTP_CLIENT_SECRET as string,
  projectKey: process.env.CTP_PROJECT_KEY as string,
  sessionUrl: process.env.CTP_SESSION_URL as string,
  checkoutUrl: getCheckoutUrl(),
  jwksUrl: process.env.CTP_JWKS_URL as string,
  jwtIssuer: process.env.CTP_JWT_ISSUER as string,
  getContextFn: (): RequestContextData => {
    const { correlationId, requestId, authentication } = getRequestContext();
    return {
      correlationId: correlationId || '',
      requestId: requestId || '',
      authentication,
    };
  },
  updateContextFn: (context: Partial<RequestContextData>) => {
    const requestContext = Object.assign(
      {},
      context.correlationId ? { correlationId: context.correlationId } : {},
      context.requestId ? { requestId: context.requestId } : {},
      context.authentication ? { authentication: context.authentication } : {},
    );
    updateRequestContext(requestContext);
  },
  logger: appLogger,
});
