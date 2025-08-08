import { getCustomObjectByKey, updateCustomObject } from '../../src/commercetools/customObject.commercetools';
import { createApiRoot } from '../../src/client/create.client';
import { log } from '../../src/libs/logger';
import { Errorx } from '@commercetools/connect-payments-sdk';

jest.mock('../../src/client/create.client');
jest.mock('../../src/libs/logger');

describe('Custom Object Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('updateCustomObject', () => {
    const customObjectDraft = {
      container: 'testContainer',
      key: 'testKey',
      value: { someField: 'someValue' },
    };

    it('should successfully update a custom object and return the object', async () => {
      const mockResponse = {
        body: { container: 'testContainer', key: 'testKey', value: { someField: 'someValue' } },
      };
      (createApiRoot as jest.Mock).mockReturnValue({
        customObjects: () => ({
          post: () => ({
            execute: jest.fn().mockResolvedValue(mockResponse),
          }),
        }),
      });

      const result = await updateCustomObject(customObjectDraft);

      expect(result).toEqual(mockResponse.body);
      expect(createApiRoot).toHaveBeenCalled();
    });

    it('should log an error and throw an Errorx if the request fails', async () => {
      const errorResponse = {
        code: 'InternalError',
        body: {
          message: 'Something went wrong',
          errors: [{ field: 'key', message: 'Invalid key' }],
        },
        statusCode: 500,
      };

      (createApiRoot as jest.Mock).mockReturnValue({
        customObjects: () => ({
          post: () => ({
            execute: jest.fn().mockRejectedValue(errorResponse),
          }),
        }),
      });

      await expect(updateCustomObject(customObjectDraft)).rejects.toThrow(Errorx);
      expect(log.error).toHaveBeenCalledWith('Error in updateCustomObject', errorResponse);
    });
  });

  describe('getCustomObjectByKey', () => {
    const container = 'testContainer';
    const key = 'testKey';

    it('should successfully get a custom object by key and return the object', async () => {
      const mockResponse = {
        body: { container: 'testContainer', key: 'testKey', value: { someField: 'someValue' } },
      };
      (createApiRoot as jest.Mock).mockReturnValue({
        customObjects: () => ({
          withContainerAndKey: () => ({
            get: () => ({
              execute: jest.fn().mockResolvedValue(mockResponse),
            }),
          }),
        }),
      });

      const result = await getCustomObjectByKey(container, key);

      expect(result).toEqual(mockResponse.body);
      expect(createApiRoot).toHaveBeenCalled();
    });

    it('should log an error and throw an Errorx if the request fails', async () => {
      const errorResponse = {
        code: 'InternalError',
        body: {
          message: 'Something went wrong',
          errors: [{ field: 'key', message: 'Invalid key' }],
        },
        statusCode: 404,
      };

      (createApiRoot as jest.Mock).mockReturnValue({
        customObjects: () => ({
          withContainerAndKey: () => ({
            get: () => ({
              execute: jest.fn().mockRejectedValue(errorResponse),
            }),
          }),
        }),
      });

      await expect(getCustomObjectByKey(container, key)).rejects.toThrow(Errorx);
      expect(log.error).toHaveBeenCalledWith('Error in getCustomObjectByKey', errorResponse);
    });
  });
});
