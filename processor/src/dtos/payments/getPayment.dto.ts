import { Static, Type } from '@sinclair/typebox';
import { ECTransactionPaymentType } from '../../types/payment.types';

export const GetPaymentParamsSchema = {
  $id: 'paramsSchema',
  type: 'object',
  properties: {
    id: Type.String(),
  },
  required: ['paymentId'],
};

export const GetPaymentResponseSchema = Type.Object({
  webShopId: Type.String(),
  amount: Type.Number(),
  status: Type.String(),
  paymentType: Type.Optional(Type.Enum(ECTransactionPaymentType)),
  decision: Type.Object({
    interest: Type.Optional(Type.Number()),
    totalValue: Type.Optional(Type.Number()),
    orderValue: Type.Number(),
    decisionOutcome: Type.String(),
    numberOfInstallments: Type.Optional(Type.Number()),
    installment: Type.Optional(Type.Number()),
    lastInstallment: Type.Optional(Type.Number()),
    mtan: Type.Optional(
      Type.Object({
        required: Type.Boolean(),
        successful: Type.Boolean(),
      }),
    ),
    bankAccountCheck: Type.Optional(
      Type.Object({
        required: Type.Boolean(),
      }),
    ),
  }),
});

export type GetPaymentResponseSchemaDTO = Static<typeof GetPaymentResponseSchema>;
