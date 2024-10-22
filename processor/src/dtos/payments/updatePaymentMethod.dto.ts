import { Static, Type } from '@sinclair/typebox';

export const CancelPaymentResponseSchema = Type.Null({
  paymentId: Type.String(),
});

export type CancelPaymentResponseSchemaDTO = Static<typeof CancelPaymentResponseSchema>;
