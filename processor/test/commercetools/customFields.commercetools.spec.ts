import { createCustomPaymentTransactionECTechnicalTransactionId } from '../../src/commercetools/customFields.commercetools';
import { createApiRoot } from '../../src/client/create.client';
import { EASYCREDIT_TECHNICAL_TRANSACTION_ID } from '../../src/utils/constant.utils';

jest.mock('../../src/client/create.client');

describe('createCustomPaymentTransactionECTechnicalTransactionId', () => {
  const mockTypesGet = jest.fn();
  const mockTypesPost = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    // Mocking API root and responses
    (createApiRoot as jest.Mock).mockReturnValue({
      types: jest.fn(() => ({
        get: mockTypesGet,
        post: mockTypesPost,
      })),
    });
  });

  it('should not create a new type if EASYCREDIT_TECHNICAL_TRANSACTION_ID type exists', async () => {
    // Simulate the type already existing
    mockTypesGet.mockReturnValue({
      execute: jest.fn().mockResolvedValue({
        body: { results: [{ key: EASYCREDIT_TECHNICAL_TRANSACTION_ID }] },
      }),
    });

    await createCustomPaymentTransactionECTechnicalTransactionId();

    expect(createApiRoot).toHaveBeenCalledTimes(1);
    expect(mockTypesGet).toHaveBeenCalledWith({
      queryArgs: { where: `key = "${EASYCREDIT_TECHNICAL_TRANSACTION_ID}"` },
    });
    expect(mockTypesPost).not.toHaveBeenCalled(); // Ensure no type creation is triggered
  });

  it('should create a new type if EASYCREDIT_TECHNICAL_TRANSACTION_ID type does not exist', async () => {
    // Simulate the type not existing
    mockTypesGet.mockReturnValue({
      execute: jest.fn().mockResolvedValue({
        body: { results: [] },
      }),
    });

    mockTypesPost.mockReturnValue({
      execute: jest.fn().mockResolvedValue({}),
    });

    await createCustomPaymentTransactionECTechnicalTransactionId();

    expect(createApiRoot).toHaveBeenCalledTimes(1);
    expect(mockTypesGet).toHaveBeenCalledWith({
      queryArgs: { where: `key = "${EASYCREDIT_TECHNICAL_TRANSACTION_ID}"` },
    });
    expect(mockTypesPost).toHaveBeenCalledWith({
      body: {
        key: EASYCREDIT_TECHNICAL_TRANSACTION_ID,
        name: {
          en: 'EasyCredit Technical Transaction ID',
          de: 'EasyCredit Technical Transaction ID',
        },
        resourceTypeIds: ['transaction'],
        fieldDefinitions: [
          {
            name: 'easyCreditTechnicalTransactionId',
            label: {
              en: 'EasyCredit Technical Transaction ID',
              de: 'EasyCredit Technical Transaction ID',
            },
            required: false,
            type: {
              name: 'String',
            },
          },
        ],
      },
    });
  });
});
