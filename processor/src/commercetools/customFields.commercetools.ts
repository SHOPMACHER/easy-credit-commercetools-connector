import { FieldDefinition, ResourceTypeId } from '@commercetools/platform-sdk';
import { createApiRoot } from '../client/create.client';
import {
  EASYCREDIT_EARLIER_CAPTURE_BOOKINGS_FIELD,
  EASYCREDIT_EXPRESS_FIELD,
  EASYCREDIT_EXPRESS_PLACEHOLDER_FIELD,
  EASYCREDIT_INTEREST_FIELD,
  EASYCREDIT_TECHNICAL_TRANSACTION_ID_FIELD,
  EASYCREDIT_TOTAL_VALUE_FIELD,
} from '../utils/constant.utils';

const TRANSACTION_FIELD_DEFINITIONS: FieldDefinition[] = [
  {
    name: EASYCREDIT_TECHNICAL_TRANSACTION_ID_FIELD,
    label: {
      en: 'EasyCredit Technical Transaction ID',
      de: 'EasyCredit Technical Transaction ID',
    },
    required: false,
    type: {
      name: 'String',
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
      name: 'Number',
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
      name: 'Number',
    },
  },
  {
    name: EASYCREDIT_EARLIER_CAPTURE_BOOKINGS_FIELD,
    label: {
      en: 'EasyCredit capture bookings before this Charge',
      de: 'EasyCredit Capture-Buchungen vor dieser Belastung',
    },
    required: false,
    type: {
      name: 'Set',
      elementType: { name: 'String' },
    },
  },
];

const PAYMENT_FIELD_DEFINITIONS: FieldDefinition[] = [
  {
    name: EASYCREDIT_EXPRESS_FIELD,
    label: {
      en: 'EasyCredit Express Checkout',
      de: 'EasyCredit Express Checkout',
    },
    required: false,
    type: {
      name: 'Boolean',
    },
  },
  {
    name: EASYCREDIT_EXPRESS_PLACEHOLDER_FIELD,
    label: {
      en: 'EasyCredit Express Placeholder Address',
      de: 'EasyCredit Express Placeholder Address',
    },
    required: false,
    type: {
      name: 'Boolean',
    },
  },
];

type CustomTypeSpec = {
  typeKey: string;
  resourceTypeId: ResourceTypeId;
  // Config key named in the error, so the merchant knows which setting to change
  configKey: string;
  fieldDefinitions: FieldDefinition[];
};

// Adds only the missing fields, so a type shared with other connectors keeps theirs.
async function createOrUpdateCustomType({
  typeKey,
  resourceTypeId,
  configKey,
  fieldDefinitions,
}: CustomTypeSpec): Promise<void> {
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

    if (!existingType.resourceTypeIds.includes(resourceTypeId)) {
      throw new Error(
        `Custom type "${typeKey}" exists but does not include "${resourceTypeId}" in its resourceTypeIds. ` +
          `Please use a different ${configKey} or add "${resourceTypeId}" to the existing type.`,
      );
    }

    const missingFields = fieldDefinitions.filter(
      ({ name }) => !existingType.fieldDefinitions.some((field) => field.name === name),
    );

    if (missingFields.length > 0) {
      await apiRoot
        .types()
        .withKey({ key: typeKey })
        .post({
          body: {
            version: existingType.version,
            actions: missingFields.map((fieldDefinition) => ({
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
            en: `Custom type for ${resourceTypeId} resources`,
            de: `Custom type for ${resourceTypeId} resources`,
          },
          resourceTypeIds: [resourceTypeId],
          fieldDefinitions,
        },
      })
      .execute();
  }
}

export async function createOrUpdateTransactionCustomType(typeKey: string): Promise<void> {
  await createOrUpdateCustomType({
    typeKey,
    resourceTypeId: 'transaction',
    configKey: 'TRANSACTION_CUSTOM_TYPE_KEY',
    fieldDefinitions: TRANSACTION_FIELD_DEFINITIONS,
  });
}

export async function createOrUpdatePaymentCustomType(typeKey: string): Promise<void> {
  await createOrUpdateCustomType({
    typeKey,
    resourceTypeId: 'payment',
    configKey: 'PAYMENT_CUSTOM_TYPE_KEY',
    fieldDefinitions: PAYMENT_FIELD_DEFINITIONS,
  });
}

// Only a positive answer is cached: a type created by a later post-deploy is picked up without a restart.
const readyPaymentCustomTypeKeys = new Set<string>();

export async function isPaymentCustomTypeReady(typeKey: string): Promise<boolean> {
  if (readyPaymentCustomTypeKeys.has(typeKey)) {
    return true;
  }

  const {
    body: { results: types },
  } = await createApiRoot()
    .types()
    .get({ queryArgs: { where: `key = "${typeKey}"` } })
    .execute();

  const type = types[0];
  const ready =
    !!type &&
    type.resourceTypeIds.includes('payment') &&
    PAYMENT_FIELD_DEFINITIONS.every(({ name }) => type.fieldDefinitions.some((field) => field.name === name));

  if (ready) {
    readyPaymentCustomTypeKeys.add(typeKey);
  }

  return ready;
}
