import { createApiRoot } from '../client/create.client';
import {
  EASYCREDIT_INTEREST_FIELD,
  EASYCREDIT_TECHNICAL_TRANSACTION_ID_FIELD,
  EASYCREDIT_TOTAL_VALUE_FIELD,
} from '../utils/constant.utils';

const FIELD_DEFINITIONS = [
  {
    name: EASYCREDIT_TECHNICAL_TRANSACTION_ID_FIELD,
    label: {
      en: 'EasyCredit Technical Transaction ID',
      de: 'EasyCredit Technical Transaction ID',
    },
    required: false,
    type: {
      name: 'String' as const,
    },
  },
  {
    name: EASYCREDIT_INTEREST_FIELD,
    label: {
      en: 'EasyCredit Interest',
      de: 'EasyCredit Zinsen',
    },
    required: false,
    type: {
      name: 'Number' as const,
    },
  },
  {
    name: EASYCREDIT_TOTAL_VALUE_FIELD,
    label: {
      en: 'EasyCredit Total Value',
      de: 'EasyCredit Gesamtsumme',
    },
    required: false,
    type: {
      name: 'Number' as const,
    },
  },
];

export async function createOrUpdateTransactionCustomType(typeKey: string): Promise<void> {
  const apiRoot = createApiRoot();

  const {
    body: { results: types },
  } = await apiRoot
    .types()
    .get({
      queryArgs: {
        where: `key = "${typeKey}"`,
      },
    })
    .execute();

  if (types.length > 0) {
    const existingType = types[0];

    if (!existingType.resourceTypeIds.includes('transaction')) {
      throw new Error(
        `Custom type "${typeKey}" exists but does not include "transaction" in its resourceTypeIds. ` +
          `Please use a different TRANSACTION_CUSTOM_TYPE_KEY or add "transaction" to the existing type.`,
      );
    }

    const missingDefinitions = FIELD_DEFINITIONS.filter(
      ({ name }) => !existingType.fieldDefinitions.some((field) => field.name === name),
    );

    if (missingDefinitions.length > 0) {
      await apiRoot
        .types()
        .withKey({ key: typeKey })
        .post({
          body: {
            version: existingType.version,
            actions: missingDefinitions.map((fieldDefinition) => ({
              action: 'addFieldDefinition' as const,
              fieldDefinition,
            })),
          },
        })
        .execute();
    }
  } else {
    await apiRoot
      .types()
      .post({
        body: {
          key: typeKey,
          name: {
            en: 'Custom type for transaction resources',
            de: 'Custom type for transaction resources',
          },
          resourceTypeIds: ['transaction'],
          fieldDefinitions: FIELD_DEFINITIONS,
        },
      })
      .execute();
  }
}
