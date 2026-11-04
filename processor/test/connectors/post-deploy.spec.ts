import { postDeploy, runPostDeployScripts } from '../../src/connectors/post-deploy';
import { updateCustomObject } from '../../src/commercetools/customObject.commercetools';
import {
  createOrUpdatePaymentCustomType,
  createOrUpdateTransactionCustomType,
} from '../../src/commercetools/customFields.commercetools';

jest.mock('../../src/commercetools/customObject.commercetools');
jest.mock('../../src/commercetools/customFields.commercetools');

describe('post-deploy', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = undefined;
    delete process.env.TRANSACTION_CUSTOM_TYPE_KEY;
    delete process.env.PAYMENT_CUSTOM_TYPE_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.exitCode = undefined;
  });

  it('should store the connector URL and create both custom types with their default keys', async () => {
    await postDeploy(new Map([['CONNECT_SERVICE_URL', 'https://connector.example.com']]));

    expect(updateCustomObject).toHaveBeenCalledWith({
      container: 'easycredit-connector',
      key: 'easycredit-connector-url',
      value: 'https://connector.example.com',
    });
    expect(createOrUpdateTransactionCustomType).toHaveBeenCalledWith('easy-credit-technical-transaction-id');
    expect(createOrUpdatePaymentCustomType).toHaveBeenCalledWith('easy-credit-payment');
  });

  it('should use the configured custom type keys', async () => {
    process.env.TRANSACTION_CUSTOM_TYPE_KEY = 'shared-transaction-type';
    process.env.PAYMENT_CUSTOM_TYPE_KEY = 'shared-payment-type';

    await postDeploy(new Map([['CONNECT_SERVICE_URL', 'https://connector.example.com']]));

    expect(createOrUpdateTransactionCustomType).toHaveBeenCalledWith('shared-transaction-type');
    expect(createOrUpdatePaymentCustomType).toHaveBeenCalledWith('shared-payment-type');
  });

  it('should fail without the connector URL before anything is written', async () => {
    await expect(postDeploy(new Map())).rejects.toThrow('CONNECT_SERVICE_URL');

    expect(updateCustomObject).not.toHaveBeenCalled();
    expect(createOrUpdatePaymentCustomType).not.toHaveBeenCalled();
  });

  it('should fail the deployment when the payment custom type cannot be created', async () => {
    process.env.CONNECT_SERVICE_URL = 'https://connector.example.com';
    (createOrUpdatePaymentCustomType as jest.Mock).mockRejectedValue(new Error('type is not for payments'));
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await runPostDeployScripts();

      expect(process.exitCode).toBe(1);
      expect(stderr).toHaveBeenCalledWith('Post-deploy failed: type is not for payments\n');
    } finally {
      stderr.mockRestore();
    }
  });
});
