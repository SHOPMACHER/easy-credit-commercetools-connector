import { Static, Type } from '@sinclair/typebox';

const AmountLimitsSchema = Type.Object({
  minAmount: Type.Number(),
  maxAmount: Type.Number(),
});

export const WidgetEnabledResponseSchema = Type.Object({
  isEnabled: Type.Boolean(),
  webShopId: Type.String(),
  // Payment types the widget may advertise (INSTALLMENT_PAYMENT, BILL_PAYMENT), as checkout would offer them.
  paymentTypes: Type.Array(Type.Union([Type.Literal('INSTALLMENT_PAYMENT'), Type.Literal('BILL_PAYMENT')])),
  // Only for payment types whose limits the merchant narrowed; the widget applies easyCredit's limits itself.
  amountLimits: Type.Optional(
    Type.Object({
      INSTALLMENT_PAYMENT: Type.Optional(AmountLimitsSchema),
      BILL_PAYMENT: Type.Optional(AmountLimitsSchema),
    }),
  ),
});

export type WidgetEnabledResponseSchemaDTO = Static<typeof WidgetEnabledResponseSchema>;
