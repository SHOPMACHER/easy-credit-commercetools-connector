import { ClientBuilder } from '@commercetools/sdk-client-v2';
import { createClient } from '../../src/client/build.client';
import { authMiddlewareOptions } from '../../src/middleware/auth.middleware';
import { httpMiddlewareOptions } from '../../src/middleware/http.middleware';
import { userAgentMiddlewareOptions } from '../../src/middleware/userAgent.middleware';

// Mock ClientBuilder and its methods
const mockWithProjectKey = jest.fn().mockReturnThis();
const mockWithClientCredentialsFlow = jest.fn().mockReturnThis();
const mockWithHttpMiddleware = jest.fn().mockReturnThis();
const mockWithUserAgentMiddleware = jest.fn().mockReturnThis();
const mockBuild = jest.fn();

// Mock dependencies
jest.mock('@commercetools/sdk-client-v2', () => ({
  ClientBuilder: jest.fn().mockImplementation(() => ({
    withProjectKey: mockWithProjectKey,
    withClientCredentialsFlow: mockWithClientCredentialsFlow,
    withHttpMiddleware: mockWithHttpMiddleware,
    withUserAgentMiddleware: mockWithUserAgentMiddleware,
    build: mockBuild,
  })),
}));

jest.mock('../../src/middleware/auth.middleware', () => ({
  authMiddlewareOptions: { clientId: 'mock-client-id', clientSecret: 'mock-client-secret' },
}));

jest.mock('../../src/middleware/http.middleware', () => ({
  httpMiddlewareOptions: { host: 'http://mock-host', timeout: 1000 },
}));

jest.mock('../../src/middleware/userAgent.middleware', () => ({
  userAgentMiddlewareOptions: { name: 'mock-user-agent', version: '1.0.0' },
}));

jest.mock('../../src/utils/config.utils', () => ({
  readConfiguration: jest.fn().mockReturnValue({
    commerceTools: { projectKey: 'mock-project-key' },
  }),
}));

describe('createClient', () => {
  it('should create a client with the correct configuration', () => {
    createClient();

    expect(ClientBuilder).toHaveBeenCalledTimes(1);

    expect(mockWithProjectKey).toHaveBeenCalledWith('mock-project-key');
    expect(mockWithClientCredentialsFlow).toHaveBeenCalledWith(authMiddlewareOptions);
    expect(mockWithHttpMiddleware).toHaveBeenCalledWith(httpMiddlewareOptions);
    expect(mockWithUserAgentMiddleware).toHaveBeenCalledWith(userAgentMiddlewareOptions);

    expect(mockBuild).toHaveBeenCalledTimes(1);
  });
});
