import { Static, Type } from '@sinclair/typebox';

export const GetEasyCreditNotificationParamsSchema = {
  $id: 'paramsSchema',
  type: 'object',
  properties: {
    resourceId: Type.String(),
  },
  required: ['resourceId'],
};

export const GetEasyCreditNotificationResponseSchema = Type.Object({});

export type GetEasyCreditNotificationResponseSchemaDTO = Static<typeof GetEasyCreditNotificationResponseSchema>;
