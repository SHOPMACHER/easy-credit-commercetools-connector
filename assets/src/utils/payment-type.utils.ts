import { PaymentType } from '../types/main';

export const DEFAULT_PAYMENT_TYPE: PaymentType = 'INSTALLMENT_PAYMENT';

// The easyCredit web components name the payment types differently than the easyCredit API.
const WEB_COMPONENT_PAYMENT_TYPES: Record<PaymentType, string> = {
  INSTALLMENT_PAYMENT: 'INSTALLMENT',
  BILL_PAYMENT: 'BILL',
};

export const toWebComponentPaymentType = (paymentType: PaymentType = DEFAULT_PAYMENT_TYPE): string =>
  WEB_COMPONENT_PAYMENT_TYPES[paymentType];
