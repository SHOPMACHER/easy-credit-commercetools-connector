import { Static, Type } from '@sinclair/typebox';

export const WidgetEnabledResponseSchema = Type.Object({
  isEnabled: Type.Boolean(),
  webShopId: Type.String(),
  // Payment types the widget may advertise (INSTALLMENT_PAYMENT, BILL_PAYMENT), as checkout would offer them.
  paymentTypes: Type.Array(Type.Union([Type.Literal('INSTALLMENT_PAYMENT'), Type.Literal('BILL_PAYMENT')])),
});

export type WidgetEnabledResponseSchemaDTO = Static<typeof WidgetEnabledResponseSchema>;
