import { createApiRoot } from '../client/create.client';
import { EASYCREDIT_TECHNICAL_TRANSACTION_ID_FIELD } from '../utils/constant.utils';

const FIELD_DEFINITION = {
  name: EASYCREDIT_TECHNICAL_TRANSACTION_ID_FIELD,
  label: {
    en: 'EasyCredit Technical Transaction ID',
    de: 'EasyCredit Technical Transaction ID',
  },
  required: false,
  type: {
    name: 'String' as const,
  },
};

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

    const hasField = existingType.fieldDefinitions.some(
      (field) => field.name === EASYCREDIT_TECHNICAL_TRANSACTION_ID_FIELD,
    );

    if (!hasField) {
      await apiRoot
        .types()
        .withKey({ key: typeKey })
        .post({
          body: {
            version: existingType.version,
            actions: [
              {
                action: 'addFieldDefinition',
                fieldDefinition: FIELD_DEFINITION,
              },
            ],
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
          fieldDefinitions: [FIELD_DEFINITION],
        },
      })
      .execute();
  }
}
