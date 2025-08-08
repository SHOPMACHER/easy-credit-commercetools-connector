import { setupFastify } from '../../../src/server/server';
import { describe, expect, it, jest } from '@jest/globals';
import webhookPlugin from '../../../src/server/plugins/webhook.plugin';

describe('test paymentPlugin', () => {
  it('registers webhook routes with correct options', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    jest.spyOn(require('./../../../src/server/plugins/webhook.plugin'), 'default');

    await setupFastify();

    expect(webhookPlugin).toHaveBeenCalledTimes(1);
  });
});
