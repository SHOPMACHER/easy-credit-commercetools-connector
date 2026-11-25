import { getOrderHistoryOfCustomer } from '../../src/commercetools/order.commercetools';
import { createApiRoot } from '../../src/client/create.client';

jest.mock('../../src/client/create.client');

const mockOrders = (body: unknown) => {
  const get = jest.fn().mockReturnValue({ execute: jest.fn().mockResolvedValue({ body }) });
  (createApiRoot as jest.Mock).mockReturnValue({ orders: jest.fn(() => ({ get })) });
  return get;
};

describe('getOrderHistoryOfCustomer', () => {
  it('should count the orders and read the date of the oldest one', async () => {
    const get = mockOrders({ total: 4, results: [{ createdAt: '2023-11-03T07:59:35.132Z' }] });

    await expect(getOrderHistoryOfCustomer('customer-1')).resolves.toEqual({
      numberOfOrders: 4,
      firstOrderDate: '2023-11-03',
    });
    expect(get).toHaveBeenCalledWith({
      queryArgs: {
        where: 'customerId = :customerId',
        'var.customerId': 'customer-1',
        sort: 'createdAt asc',
        limit: 1,
        withTotal: true,
      },
    });
  });

  it('should have no date and 0 orders without orders', async () => {
    mockOrders({ results: [] });

    await expect(getOrderHistoryOfCustomer('customer-1')).resolves.toEqual({ numberOfOrders: 0 });
  });
});
