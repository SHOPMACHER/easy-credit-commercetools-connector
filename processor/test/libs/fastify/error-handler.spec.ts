import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import Fastify, { FastifyError, type FastifyInstance } from 'fastify';
import { errorHandler } from '../../../src/libs/fastify/error-handler';
import { ErrorAuthErrorResponse, Errorx, ErrorxAdditionalOpts } from '@commercetools/connect-payments-sdk';
import { requestContextPlugin } from '../../../src/libs/fastify/context/context';
import { FastifySchemaValidationError } from 'fastify/types/schema';

describe('error-handler', () => {
  let fastify: FastifyInstance;
  beforeEach(async () => {
    fastify = Fastify();
    fastify.setErrorHandler(errorHandler);
    await fastify.register(requestContextPlugin);
  });

  afterEach(async () => {
    await fastify.close();
  });

  test('errox error', async () => {
    fastify.get('/', () => {
      throw new Errorx({
        code: 'ErrorCode',
        httpErrorStatus: 404,
        fields: [
          {
            test: 'field1',
          },
        ],
        message: 'someMessage',
      });
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/',
    });

    expect(response.json()).toStrictEqual({
      message: 'someMessage',
      statusCode: 404,
      errors: [
        {
          code: 'ErrorCode',
          message: 'someMessage',
          fields: [
            {
              test: 'field1',
            },
          ],
        },
      ],
    });
  });

  test('errox with fields', async () => {
    fastify.get('/', () => {
      throw new Errorx({
        code: 'ErrorCode',
        message: 'someMessage',
        httpErrorStatus: 404,
        fields: [
          {
            test: 'field1',
          },
        ],
      });
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/',
    });

    expect(response.json()).toStrictEqual({
      message: 'someMessage',
      statusCode: 404,
      errors: [{ code: 'ErrorCode', message: 'someMessage', fields: [{ test: 'field1' }] }],
    });
  });

  test('general error', async () => {
    fastify.get('/', () => {
      throw new Error('some message goes here');
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/',
    });

    expect(response.json()).toStrictEqual({
      message: 'Internal server error.',
      statusCode: 500,
      errors: [
        {
          code: 'General',
          message: 'Internal server error.',
        },
      ],
    });
  });

  test('Fastify error with missing required field', async () => {
    const validationError: FastifySchemaValidationError = {
      keyword: 'required',
      instancePath: 'instancePath/domain/value',
      schemaPath: 'schemaPath/domain/value',
      params: {
        missingProperty: 'dummy-field',
      },
      message: 'fastify-error-message',
    };
    const fastifyError: FastifyError = {
      code: 'ErrorCode',
      name: 'fastify-error',
      message: 'fastify-error-message',
      validation: [validationError],
    };
    fastify.get('/', () => {
      throw fastifyError;
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/',
    });
    expect(response.json()).toStrictEqual({
      message: 'A value is required for field dummy-field.',
      statusCode: 400,
      errors: [
        {
          code: 'RequiredField',
          message: 'A value is required for field dummy-field.',
          fields: { field: 'dummy-field' },
        },
      ],
    });
  });

  test.each([
    { context: 'querystring', route: '/', request: { method: 'GET' as const, url: '/?mode=x' } },
    { context: 'params', route: '/:mode', request: { method: 'GET' as const, url: '/x' } },
    { context: 'body', route: '/', request: { method: 'POST' as const, url: '/', payload: { mode: 'x' } } },
  ])('Fastify enum error in the $context reports the invalid value', async ({ context, route, request }) => {
    fastify.route({
      method: request.method,
      url: route,
      schema: { [context]: { type: 'object', properties: { mode: { type: 'string', enum: ['a', 'b'] } } } },
      handler: () => ({}),
    });

    const response = await fastify.inject(request);

    expect(response.statusCode).toBe(400);
    expect(response.json().errors).toStrictEqual([
      {
        code: 'InvalidField',
        message: 'The value x is not valid for field mode.',
        fields: { field: 'mode', invalidValue: 'x', allowedValues: ['a', 'b'] },
      },
    ]);
  });

  test('Fastify enum error without the validated input does not fail', async () => {
    const validationError: FastifySchemaValidationError = {
      keyword: 'enum',
      instancePath: '/mode',
      schemaPath: '#/properties/mode/enum',
      params: { allowedValues: ['a', 'b'] },
      message: 'must be equal to one of the allowed values',
    };
    fastify.get('/', () => {
      throw { code: 'ErrorCode', name: 'fastify-error', message: 'error', validation: [validationError] };
    });

    const response = await fastify.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(400);
    expect(response.json().errors[0]).toEqual(expect.objectContaining({ code: 'InvalidField' }));
  });

  test('ErrorAuthErrorResponse', async () => {
    const opts: ErrorxAdditionalOpts = {
      privateFields: {},
      privateMessage: '',
      fields: {},
      skipLog: true,
      cause: undefined,
    };
    const authErrorResponse: ErrorAuthErrorResponse = new ErrorAuthErrorResponse('someMessage', opts, '401');

    fastify.get('/', () => {
      throw authErrorResponse;
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/',
    });

    expect(response.json()).toStrictEqual({
      message: 'someMessage',
      statusCode: 401,
      errors: [{ code: '401', message: 'someMessage', fields: {} }],
      error: '401',
      error_description: 'someMessage',
    });
  });
});
