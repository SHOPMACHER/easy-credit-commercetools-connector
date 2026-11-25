import { PaymentType } from '../types/main';

export const DEFAULT_PAYMENT_TYPE: PaymentType = 'INSTALLMENT_PAYMENT';

// The easyCredit web components name the payment types differently than the easyCredit API.
const WEB_COMPONENT_PAYMENT_TYPES: Record<PaymentType, string> = {
  INSTALLMENT_PAYMENT: 'INSTALLMENT',
  BILL_PAYMENT: 'BILL',
};

export const toWebComponentPaymentType = (paymentType: PaymentType = DEFAULT_PAYMENT_TYPE): string =>
  WEB_COMPONENT_PAYMENT_TYPES[paymentType];

// Undefined for an unknown type: the value comes from an event of the web component, so it is not type checked.
export const fromWebComponentPaymentType = (type: 'INSTALLMENT' | 'BILL'): PaymentType | undefined =>
  (Object.keys(WEB_COMPONENT_PAYMENT_TYPES) as PaymentType[]).find((key) => WEB_COMPONENT_PAYMENT_TYPES[key] === type);

export const isPaymentType = (paymentType: unknown): paymentType is PaymentType =>
  Object.keys(WEB_COMPONENT_PAYMENT_TYPES).includes(paymentType as string);

// Plain JS callers get no type check, so an unknown type must fail with a clear message instead of a TypeError later.
export const assertPaymentType = (paymentType: unknown): void => {
  if (paymentType !== undefined && !isPaymentType(paymentType)) {
    throw new Error(
      `Invalid easyCredit paymentType "${String(paymentType)}", expected one of ${Object.keys(WEB_COMPONENT_PAYMENT_TYPES).join(', ')}.`,
    );
  }
};
