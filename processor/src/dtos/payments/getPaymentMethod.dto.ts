import { Static, Type } from '@sinclair/typebox';

export const GetPaymentMethodQueryStringSchema = Type.Object({
  cartId: Type.String(),
});

export const GetPaymentMethodResponseSchema = Type.Object({
  webShopId: Type.String(),
});

export type GetPaymentMethodResponseSchemaDTO = Static<typeof GetPaymentMethodResponseSchema>;
