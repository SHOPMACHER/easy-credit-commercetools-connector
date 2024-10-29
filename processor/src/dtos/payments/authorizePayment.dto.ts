import { Static, Type } from '@sinclair/typebox';

export const AuthorizePaymentBodySchema = Type.Object({
  orderId: Type.Optional(Type.String()),
});

export const AuthorizePaymentResponseSchema = Type.Object({});

export type AuthorizePaymentRequestSchemaDTO = Static<typeof AuthorizePaymentBodySchema>;

export type AuthorizePaymentResponseSchemaDTO = Static<typeof AuthorizePaymentResponseSchema>;
