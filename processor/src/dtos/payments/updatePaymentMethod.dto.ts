import { Static, Type } from '@sinclair/typebox';

export const CancelPaymentResponseSchema = Type.Object({
  paymentId: Type.String(),
});

export const AuthorizePaymentResponseSchema = Type.Object({
  paymentId: Type.String(),
});

export type CancelPaymentResponseSchemaDTO = Static<typeof CancelPaymentResponseSchema>;

export type AuthorizePaymentResponseSchemaDTO = Static<typeof AuthorizePaymentResponseSchema>;
