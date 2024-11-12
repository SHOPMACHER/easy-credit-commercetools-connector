import { createApiRoot } from '../client/create.client';
import { EASYCREDIT_TECHNICAL_TRANSACTION_ID } from '../utils/constant.utils';

export async function createCustomPaymentTransactionECTechnicalTransactionId(): Promise<void> {
  const apiRoot = createApiRoot();

  const {
    body: { results: types },
  } = await apiRoot
    .types()
    .get({
      queryArgs: {
        where: `key = "${EASYCREDIT_TECHNICAL_TRANSACTION_ID}"`,
      },
    })
    .execute();

  if (types.length <= 0) {
    await apiRoot
      .types()
      .post({
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
      })
      .execute();
  }
}
