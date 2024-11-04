import { setupFastify } from '../../../src/server/server';
import { describe, jest, it, expect } from '@jest/globals';
import easycreditNotificationPlugin from '../../../src/server/plugins/easycreditNotification.plugin';

describe('test easycreditNotification plugin', () => {
  it('registers easycreditNotification routes with correct options', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    jest.spyOn(require('./../../../src/server/plugins/easycreditNotification.plugin'), 'default');

    await setupFastify();

    expect(easycreditNotificationPlugin).toHaveBeenCalledTimes(1);
  });
});
