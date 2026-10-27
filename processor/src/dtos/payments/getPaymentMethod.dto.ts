import { Static, Type } from '@sinclair/typebox';
import { ECTransactionPaymentType } from '../../types/payment.types';

export const GetPaymentMethodParamsSchema = {
  $id: 'paramsSchema',
  type: 'object',
  properties: {
    cartId: Type.String(),
  },
  required: ['cartId'],
};

// A plain enum keyword, as Type.Enum compiles to anyOf, which the error handler can only report as InvalidJsonInput.
export const GetPaymentMethodQuerySchema = Type.Object({
  paymentType: Type.Optional(
    Type.Unsafe<ECTransactionPaymentType>({ type: 'string', enum: Object.values(ECTransactionPaymentType) }),
  ),
});

export type GetPaymentMethodQuerySchemaDTO = Static<typeof GetPaymentMethodQuerySchema>;

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
