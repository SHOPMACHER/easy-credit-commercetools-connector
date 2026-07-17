import { createOrUpdateTransactionCustomType } from '../../src/commercetools/customFields.commercetools';
import { createApiRoot } from '../../src/client/create.client';
import { EASYCREDIT_TECHNICAL_TRANSACTION_ID_FIELD } from '../../src/utils/constant.utils';

jest.mock('../../src/client/create.client');

const TEST_TYPE_KEY = 'test-transaction-custom-type';

describe('createOrUpdateTransactionCustomType', () => {
  const mockTypesGet = jest.fn();
  const mockTypesPost = jest.fn();
  const mockWithKeyPost = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    (createApiRoot as jest.Mock).mockReturnValue({
      types: jest.fn(() => ({
        get: mockTypesGet,
        post: mockTypesPost,
        withKey: jest.fn(() => ({
          post: mockWithKeyPost,
        })),
      })),
    });
  });

  it('should not modify an existing type if the field definition already exists', async () => {
    mockTypesGet.mockReturnValue({
      execute: jest.fn().mockResolvedValue({
        body: {
          results: [
            {
              key: TEST_TYPE_KEY,
              version: 1,
              resourceTypeIds: ['transaction'],
              fieldDefinitions: [{ name: EASYCREDIT_TECHNICAL_TRANSACTION_ID_FIELD }],
            },
          ],
        },
      }),
    });

    await createOrUpdateTransactionCustomType(TEST_TYPE_KEY);

    expect(mockTypesGet).toHaveBeenCalledWith({
      queryArgs: { where: `key = "${TEST_TYPE_KEY}"` },
    });
    expect(mockTypesPost).not.toHaveBeenCalled();
    expect(mockWithKeyPost).not.toHaveBeenCalled();
  });

  it('should add the field definition to an existing type if the field is missing', async () => {
    mockTypesGet.mockReturnValue({
      execute: jest.fn().mockResolvedValue({
        body: {
          results: [
            {
              key: TEST_TYPE_KEY,
              version: 3,
              resourceTypeIds: ['transaction'],
              fieldDefinitions: [{ name: 'someOtherField' }],
            },
          ],
        },
      }),
    });

    mockWithKeyPost.mockReturnValue({
      execute: jest.fn().mockResolvedValue({}),
    });

    await createOrUpdateTransactionCustomType(TEST_TYPE_KEY);

    expect(mockWithKeyPost).toHaveBeenCalledWith({
      body: {
        version: 3,
        actions: [
          {
            action: 'addFieldDefinition',
            fieldDefinition: {
              name: EASYCREDIT_TECHNICAL_TRANSACTION_ID_FIELD,
              label: {
                en: 'EasyCredit Technical Transaction ID',
                de: 'EasyCredit Technical Transaction ID',
              },
              required: false,
              type: { name: 'String' },
            },
          },
        ],
      },
    });
  });

  it('should throw if existing type does not include transaction in resourceTypeIds', async () => {
    mockTypesGet.mockReturnValue({
      execute: jest.fn().mockResolvedValue({
        body: {
          results: [
            {
              key: TEST_TYPE_KEY,
              version: 2,
              resourceTypeIds: ['order'],
              fieldDefinitions: [],
            },
          ],
        },
      }),
    });

    await expect(createOrUpdateTransactionCustomType(TEST_TYPE_KEY)).rejects.toThrow(
      `Custom type "${TEST_TYPE_KEY}" exists but does not include "transaction" in its resourceTypeIds.`,
    );

    expect(mockTypesPost).not.toHaveBeenCalled();
    expect(mockWithKeyPost).not.toHaveBeenCalled();
  });

  it('should create a new type if it does not exist', async () => {
    mockTypesGet.mockReturnValue({
      execute: jest.fn().mockResolvedValue({
        body: { results: [] },
      }),
    });

    mockTypesPost.mockReturnValue({
      execute: jest.fn().mockResolvedValue({}),
    });

    await createOrUpdateTransactionCustomType(TEST_TYPE_KEY);

    expect(mockTypesPost).toHaveBeenCalledWith({
      body: {
        key: TEST_TYPE_KEY,
        name: {
          en: 'Custom type for transaction resources',
          de: 'Custom type for transaction resources',
        },
        resourceTypeIds: ['transaction'],
        fieldDefinitions: [
          {
            name: EASYCREDIT_TECHNICAL_TRANSACTION_ID_FIELD,
            label: {
              en: 'EasyCredit Technical Transaction ID',
              de: 'EasyCredit Technical Transaction ID',
            },
            required: false,
            type: { name: 'String' },
          },
        ],
      },
    });
  });
});
