import { Static, Type } from '@sinclair/typebox';

export const GetPaymentMethodParamsSchema = {
  $id: 'paramsSchema',
  type: 'object',
  properties: {
    id: Type.String(),
  },
  required: ['cartId'],
};

export const GetPaymentMethodResponseSchema = Type.Object({
  webShopId: Type.String(),
});

export type GetPaymentMethodResponseSchemaDTO = Static<typeof GetPaymentMethodResponseSchema>;
