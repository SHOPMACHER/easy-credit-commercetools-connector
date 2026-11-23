import { Static, Type } from '@sinclair/typebox';

export const AuthorizePaymentBodySchema = Type.Object({
  trackingNumber: Type.Optional(Type.String()),
  // Opt-in: answer only once easyCredit reports the authorization, for up to 30 seconds.
  waitForAuthorization: Type.Optional(Type.Boolean()),
});

export const AuthorizePaymentResponseSchema = Type.Object({});

export type AuthorizePaymentRequestSchemaDTO = Static<typeof AuthorizePaymentBodySchema>;

export type AuthorizePaymentResponseSchemaDTO = Static<typeof AuthorizePaymentResponseSchema>;
