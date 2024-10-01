import { Static, Type } from '@sinclair/typebox';

export const HealthCheckResponseSchema = Type.Object({
  message: Type.String(),
});

export type HealthCheckResponseSchemaDTO = Static<typeof HealthCheckResponseSchema>;
