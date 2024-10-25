import { Static, Type } from '@sinclair/typebox';

export const AuthorizePaymentBodySchema = Type.Object({
  paymentId: Type.String(),
});

export const AuthorizePaymentResponseSchema = Type.Object({
  webShopId: Type.String(),
});

export type AuthorizePaymentRequestSchemaDTO = Static<typeof AuthorizePaymentBodySchema>;

export type AuthorizePaymentResponseSchemaDTO = Static<typeof AuthorizePaymentResponseSchema>;
