import { Static, Type } from '@sinclair/typebox';

export const CapturePaymentBodySchema = Type.Object({
  // easyCredit accepts at most 50 characters.
  trackingNumber: Type.Optional(Type.String({ maxLength: 50 })),
});

export const CapturePaymentResponseSchema = Type.Object({});

export type CapturePaymentRequestSchemaDTO = Static<typeof CapturePaymentBodySchema>;

export type CapturePaymentResponseSchemaDTO = Static<typeof CapturePaymentResponseSchema>;
