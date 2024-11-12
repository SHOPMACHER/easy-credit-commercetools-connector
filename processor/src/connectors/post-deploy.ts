import * as dotenv from 'dotenv';
import { assertString } from '../utils/assert.utils';
import { updateCustomObject } from '../commercetools/customObject.commercetools';
import { EASYCREDIT_CONNECTOR_KEY, EASYCREDIT_CONNECTOR_URL } from '../utils/constant.utils';
import { createCustomPaymentTransactionECTechnicalTransactionId } from '../commercetools/customFields.commercetools';
dotenv.config();

const CONNECT_APPLICATION_URL_KEY = 'CONNECT_SERVICE_URL';

async function postDeploy(_properties: Map<string, unknown>) {
  const applicationUrl = _properties.get(CONNECT_APPLICATION_URL_KEY);

  assertString(applicationUrl, CONNECT_APPLICATION_URL_KEY);

  await updateCustomObject({
    container: EASYCREDIT_CONNECTOR_KEY,
    key: EASYCREDIT_CONNECTOR_URL,
    value: applicationUrl,
  });

  await createCustomPaymentTransactionECTechnicalTransactionId();
}

async function runPostDeployScripts() {
  try {
    const properties = new Map(Object.entries(process.env));
    await postDeploy(properties);
  } catch (error) {
    if (error instanceof Error) {
      process.stderr.write(`Post-deploy failed: ${error.message}\n`);
    }
    process.exitCode = 1;
  }
}

runPostDeployScripts();
