import { Static, Type } from '@sinclair/typebox';

export const GetOptionQueryStringSchema = Type.Object({
  cartId: Type.String(),
});

export const GetOptionResponseSchema = Type.Object({
  success: Type.Boolean(),
  webShopId: Type.String(),
  errors: Type.Optional(
    Type.Array(
      Type.Object({
        code: Type.String(),
        message: Type.String(),
      }),
    ),
  ),
});

export type GetOptionResponseSchemaDTO = Static<typeof GetOptionResponseSchema>;
