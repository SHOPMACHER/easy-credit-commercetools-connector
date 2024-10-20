import { GetPaymentMethodResponseSchemaDTO } from '../dtos/payments/getPaymentMethod.dto';

export type GetPaymentMethodResponse = GetPaymentMethodResponseSchemaDTO;

export enum CTTransactionType {
  Authorization = 'Authorization',
  CancelAuthorization = 'CancelAuthorization',
  Charge = 'Charge',
  Refund = 'Refund',
  Chargeback = 'Chargeback',
}

export enum CTTransactionState {
  Initial = 'Initial',
  Pending = 'Pending',
  Success = 'Success',
  Failure = 'Failure',
}
