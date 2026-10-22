import { PaymentType } from '../types/main';

export const DEFAULT_PAYMENT_TYPE: PaymentType = 'INSTALLMENT_PAYMENT';

// The easyCredit web components name the payment types differently than the easyCredit API.
const WEB_COMPONENT_PAYMENT_TYPES: Record<PaymentType, string> = {
  INSTALLMENT_PAYMENT: 'INSTALLMENT',
  BILL_PAYMENT: 'BILL',
};

export const toWebComponentPaymentType = (paymentType: PaymentType = DEFAULT_PAYMENT_TYPE): string =>
  WEB_COMPONENT_PAYMENT_TYPES[paymentType];

// Plain JS callers get no type check, so an unknown type must fail with a clear message instead of a TypeError later.
export const assertPaymentType = (paymentType: unknown): void => {
  if (paymentType !== undefined && !Object.keys(WEB_COMPONENT_PAYMENT_TYPES).includes(paymentType as string)) {
    throw new Error(
      `Invalid easyCredit paymentType "${String(paymentType)}", expected one of ${Object.keys(WEB_COMPONENT_PAYMENT_TYPES).join(', ')}.`,
    );
  }
};
