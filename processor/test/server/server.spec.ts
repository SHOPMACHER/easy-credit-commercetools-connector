import { setupFastify } from '../../src/server/server';
import { describe, expect, it } from '@jest/globals';

describe('CORS', () => {
  it('lets browsers cache the preflight', async () => {
    const server = await setupFastify();

    const response = await server.inject({
      method: 'OPTIONS',
      url: '/operations/widget-enabled',
      headers: {
        origin: 'https://shop.example',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'content-type,x-session-id',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-max-age']).toBe('7200');
  });
});
