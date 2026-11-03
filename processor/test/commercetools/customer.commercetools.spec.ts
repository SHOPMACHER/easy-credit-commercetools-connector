import { getCustomerSince } from '../../src/commercetools/customer.commercetools';
import { createApiRoot } from '../../src/client/create.client';

jest.mock('../../src/client/create.client');

describe('getCustomerSince', () => {
  it('should return the date the account was created', async () => {
    const withId = jest.fn(() => ({
      get: () => ({ execute: jest.fn().mockResolvedValue({ body: { createdAt: '2023-11-02T03:58:57.595Z' } }) }),
    }));
    (createApiRoot as jest.Mock).mockReturnValue({ customers: jest.fn(() => ({ withId })) });

    await expect(getCustomerSince('customer-1')).resolves.toBe('2023-11-02');
    expect(withId).toHaveBeenCalledWith({ ID: 'customer-1' });
  });
});
