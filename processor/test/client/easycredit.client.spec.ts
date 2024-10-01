import { EASYCREDIT_BASE_API_URL } from '../../src/utils/constant.utils';
import { initEasyCreditClient } from './../../src/client/easycredit.client';
import { describe, jest, it, expect } from '@jest/globals';

// @ts-expect-error: Mock fetch globally
fetch = jest.fn() as jest.Mock;

describe('EasyCredit Client', () => {
  it('should include the token in the header', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const readConfig = require('../../src/utils/config.utils');

    jest.spyOn(readConfig, 'readConfiguration');

    const payload = {
      message: 'dummy message',
    };

    (fetch as unknown as jest.Mock).mockImplementation(async () =>
      Promise.resolve({
        json: () => Promise.resolve({ data: [] }),
        headers: new Headers(),
        ok: true,
        redirected: false,
        status: 201,
        statusText: 'OK',
        url: '',
      }),
    );

    initEasyCreditClient().integrationCheck(payload);

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(process.env.WEBSHOP_ID + ':' + process.env.API_PASSWORD)}`,
    };

    expect(fetch).toHaveBeenCalledWith(`${EASYCREDIT_BASE_API_URL}/payment/v3/webshop/integrationcheck`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  });
});
