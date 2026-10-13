import { Static, Type } from '@sinclair/typebox';

export const GetPaymentMethodParamsSchema = {
  $id: 'paramsSchema',
  type: 'object',
  properties: {
    cartId: Type.String(),
  },
  required: ['cartId'],
};

const PaymentTypeAvailabilitySchema = Type.Object({
  available: Type.Boolean(),
  minAmount: Type.Optional(Type.Number()),
  maxAmount: Type.Optional(Type.Number()),
});

export const GetPaymentMethodResponseSchema = Type.Object({
  webShopId: Type.String(),
  amount: Type.Number(),
  paymentTypes: Type.Object({
    INSTALLMENT_PAYMENT: PaymentTypeAvailabilitySchema,
    BILL_PAYMENT: PaymentTypeAvailabilitySchema,
  }),
});

export type GetPaymentMethodResponseSchemaDTO = Static<typeof GetPaymentMethodResponseSchema>;
