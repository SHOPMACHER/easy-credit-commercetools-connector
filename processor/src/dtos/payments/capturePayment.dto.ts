import { Static, Type } from '@sinclair/typebox';

export const CapturePaymentBodySchema = Type.Object({
  orderId: Type.Optional(Type.String()),
  trackingNumber: Type.Optional(Type.String()),
});

export const CapturePaymentResponseSchema = Type.Object({});

export type CapturePaymentRequestSchemaDTO = Static<typeof CapturePaymentBodySchema>;

export type CapturePaymentResponseSchemaDTO = Static<typeof CapturePaymentResponseSchema>;
