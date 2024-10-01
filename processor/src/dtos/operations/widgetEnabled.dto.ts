import { Static, Type } from '@sinclair/typebox';

export const WidgetEnabledResponseSchema = Type.Object({
  isEnabled: Type.Boolean(),
  webShopId: Type.String(),
});

export type WidgetEnabledResponseSchemaDTO = Static<typeof WidgetEnabledResponseSchema>;
