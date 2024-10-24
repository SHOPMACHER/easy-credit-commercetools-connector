import { Static, Type } from '@sinclair/typebox';

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
  decision: Type.Object({
    interest: Type.Number(),
    totalValue: Type.Number(),
    orderValue: Type.Number(),
    decisionOutcome: Type.String(),
    numberOfInstallments: Type.Number(),
    installment: Type.Number(),
    lastInstallment: Type.Number(),
    mtan: Type.Object({
      required: Type.Boolean(),
      successful: Type.Boolean(),
    }),
    bankAccountCheck: Type.Object({
      required: Type.Boolean(),
    }),
  }),
});

export type GetPaymentResponseSchemaDTO = Static<typeof GetPaymentResponseSchema>;
