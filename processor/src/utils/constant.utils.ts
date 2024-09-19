import { version as PACKAGE_VERSION } from '../../package.json';

export const LIBRARY_NAME = 'ShopmacherCommercetoolsEasyCreditConnector';

export const LIBRARY_VERSION = PACKAGE_VERSION;

export const EASYCREDIT_AGENT_INFO = 'uap/NJTCs6RvSnqbvawh';

export const VERSION_STRING = `${LIBRARY_NAME}/${LIBRARY_VERSION}`;

export const EASYCREDIT_VERSION_STRINGS = [
  VERSION_STRING,
  EASYCREDIT_AGENT_INFO,
];

export const CustomFields = {};

export enum ConnectorActions {
  GetPaymentMethods = 'getPaymentMethods',
  CreatePayment = 'createPayment',
  CancelPayment = 'cancelPayment',
  CreateRefund = 'createRefund',
  CancelRefund = 'cancelRefund',
  NoAction = 'noAction',
  GetApplePaySession = 'getApplePaySession',
}
