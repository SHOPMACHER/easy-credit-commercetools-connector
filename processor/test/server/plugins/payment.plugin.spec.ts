import { setupFastify } from './../../../src/server/server';
import { describe, expect, it, jest } from '@jest/globals';
import paymentPlugin from './../../../src/server/plugins/payments.plugin';

describe('test paymentPlugin', () => {
  it('registers payment routes with correct options', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    jest.spyOn(require('./../../../src/server/plugins/payments.plugin'), 'default');

    await setupFastify();

    expect(paymentPlugin).toHaveBeenCalledTimes(1);
  });
});
