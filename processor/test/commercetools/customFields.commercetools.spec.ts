import {
  createOrUpdatePaymentCustomType,
  createOrUpdateTransactionCustomType,
} from '../../src/commercetools/customFields.commercetools';
import { createApiRoot } from '../../src/client/create.client';
import {
  EASYCREDIT_EXPRESS_FIELD,
  EASYCREDIT_INTEREST_FIELD,
  EASYCREDIT_TECHNICAL_TRANSACTION_ID_FIELD,
  EASYCREDIT_TOTAL_VALUE_FIELD,
} from '../../src/utils/constant.utils';

jest.mock('../../src/client/create.client');

const TEST_TYPE_KEY = 'test-transaction-custom-type';

const technicalIdDefinition = {
  name: EASYCREDIT_TECHNICAL_TRANSACTION_ID_FIELD,
  label: {
    en: 'EasyCredit Technical Transaction ID',
    de: 'EasyCredit Technical Transaction ID',
  },
  required: false,
  type: { name: 'String' },
};

const interestDefinition = {
  name: EASYCREDIT_INTEREST_FIELD,
  label: { en: 'EasyCredit Interest', de: 'EasyCredit Zinsen' },
  required: false,
  type: { name: 'Number' },
};

const totalValueDefinition = {
  name: EASYCREDIT_TOTAL_VALUE_FIELD,
  label: { en: 'EasyCredit Total Value', de: 'EasyCredit Gesamtsumme' },
  required: false,
  type: { name: 'Number' },
};

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
              fieldDefinitions: [
                { name: EASYCREDIT_TECHNICAL_TRANSACTION_ID_FIELD },
                { name: EASYCREDIT_INTEREST_FIELD },
                { name: EASYCREDIT_TOTAL_VALUE_FIELD },
              ],
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

  it('should add every field definition to an existing type that has none of them', async () => {
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

    expect(mockWithKeyPost).toHaveBeenCalledTimes(1);
    expect(mockWithKeyPost).toHaveBeenCalledWith({
      body: {
        version: 3,
        actions: [
          { action: 'addFieldDefinition', fieldDefinition: technicalIdDefinition },
          { action: 'addFieldDefinition', fieldDefinition: interestDefinition },
          { action: 'addFieldDefinition', fieldDefinition: totalValueDefinition },
        ],
      },
    });
  });

  it('should add only the missing interest fields to an existing type', async () => {
    mockTypesGet.mockReturnValue({
      execute: jest.fn().mockResolvedValue({
        body: {
          results: [
            {
              key: TEST_TYPE_KEY,
              version: 5,
              resourceTypeIds: ['transaction'],
              fieldDefinitions: [{ name: EASYCREDIT_TECHNICAL_TRANSACTION_ID_FIELD }],
            },
          ],
        },
      }),
    });

    mockWithKeyPost.mockReturnValue({
      execute: jest.fn().mockResolvedValue({}),
    });

    await createOrUpdateTransactionCustomType(TEST_TYPE_KEY);

    expect(mockWithKeyPost).toHaveBeenCalledTimes(1);
    expect(mockWithKeyPost).toHaveBeenCalledWith({
      body: {
        version: 5,
        actions: [
          { action: 'addFieldDefinition', fieldDefinition: interestDefinition },
          { action: 'addFieldDefinition', fieldDefinition: totalValueDefinition },
        ],
      },
    });
  });

  it('should add only the total value definition if just that one is missing', async () => {
    mockTypesGet.mockReturnValue({
      execute: jest.fn().mockResolvedValue({
        body: {
          results: [
            {
              key: TEST_TYPE_KEY,
              version: 6,
              resourceTypeIds: ['transaction'],
              fieldDefinitions: [
                { name: EASYCREDIT_TECHNICAL_TRANSACTION_ID_FIELD },
                { name: EASYCREDIT_INTEREST_FIELD },
              ],
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
        version: 6,
        actions: [{ action: 'addFieldDefinition', fieldDefinition: totalValueDefinition }],
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
        fieldDefinitions: [technicalIdDefinition, interestDefinition, totalValueDefinition],
      },
    });
  });
});

describe('createOrUpdatePaymentCustomType', () => {
  const PAYMENT_TYPE_KEY = 'test-payment-custom-type';
  const mockTypesGet = jest.fn();
  const mockTypesPost = jest.fn();
  const mockWithKeyPost = jest.fn();

  const expressFieldDefinition = {
    name: EASYCREDIT_EXPRESS_FIELD,
    label: {
      en: 'EasyCredit Express Checkout',
      de: 'EasyCredit Express Checkout',
    },
    required: false,
    type: { name: 'Boolean' },
  };

  const mockExistingType = (resourceTypeIds: string[], fieldNames: string[]) =>
    mockTypesGet.mockReturnValue({
      execute: jest.fn().mockResolvedValue({
        body: {
          results: [
            {
              key: PAYMENT_TYPE_KEY,
              version: 5,
              resourceTypeIds,
              fieldDefinitions: fieldNames.map((name) => ({ name })),
            },
          ],
        },
      }),
    });

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
    mockTypesPost.mockReturnValue({ execute: jest.fn().mockResolvedValue({}) });
    mockWithKeyPost.mockReturnValue({ execute: jest.fn().mockResolvedValue({}) });
  });

  it('should create a payment type with the express field if it does not exist', async () => {
    mockTypesGet.mockReturnValue({
      execute: jest.fn().mockResolvedValue({ body: { results: [] } }),
    });

    await createOrUpdatePaymentCustomType(PAYMENT_TYPE_KEY);

    expect(mockTypesPost).toHaveBeenCalledWith({
      body: {
        key: PAYMENT_TYPE_KEY,
        name: {
          en: 'Custom type for payment resources',
          de: 'Custom type for payment resources',
        },
        resourceTypeIds: ['payment'],
        fieldDefinitions: [expressFieldDefinition],
      },
    });
  });

  it('should add the express field to a shared payment type and keep its other fields', async () => {
    mockExistingType(['payment'], ['otherConnectorField']);

    await createOrUpdatePaymentCustomType(PAYMENT_TYPE_KEY);

    expect(mockWithKeyPost).toHaveBeenCalledWith({
      body: {
        version: 5,
        actions: [{ action: 'addFieldDefinition', fieldDefinition: expressFieldDefinition }],
      },
    });
    expect(mockTypesPost).not.toHaveBeenCalled();
  });

  it('should leave a payment type alone that already has the express field', async () => {
    mockExistingType(['payment'], [EASYCREDIT_EXPRESS_FIELD]);

    await createOrUpdatePaymentCustomType(PAYMENT_TYPE_KEY);

    expect(mockWithKeyPost).not.toHaveBeenCalled();
    expect(mockTypesPost).not.toHaveBeenCalled();
  });

  it('should throw and name the config key if the type is not for payments', async () => {
    mockExistingType(['transaction'], []);

    await expect(createOrUpdatePaymentCustomType(PAYMENT_TYPE_KEY)).rejects.toThrow(
      `Custom type "${PAYMENT_TYPE_KEY}" exists but does not include "payment" in its resourceTypeIds. ` +
        'Please use a different PAYMENT_CUSTOM_TYPE_KEY or add "payment" to the existing type.',
    );
    expect(mockWithKeyPost).not.toHaveBeenCalled();
  });
});
