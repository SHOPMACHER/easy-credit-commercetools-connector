import { Static, Type } from '@sinclair/typebox';

export const RefundPaymentBodySchema = Type.Object({
  amount: Type.Number(),
});

export const RefundPaymentResponseSchema = Type.Any();

export type RefundPaymentRequestSchemaDTO = Static<typeof RefundPaymentBodySchema>;

export type RefundPaymentResponseSchemaDTO = Static<typeof RefundPaymentResponseSchema>;
