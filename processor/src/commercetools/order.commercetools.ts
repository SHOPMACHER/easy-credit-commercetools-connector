import { createApiRoot } from '../client/create.client';

export type CustomerOrderHistory = {
  numberOfOrders: number;
  // yyyy-MM-dd of the oldest order, absent without orders
  firstOrderDate?: string;
};

export const getOrderHistoryOfCustomer = async (customerId: string): Promise<CustomerOrderHistory> => {
  const {
    body: { total, results },
  } = await createApiRoot()
    .orders()
    .get({
      queryArgs: {
        where: 'customerId = :customerId',
        'var.customerId': customerId,
        sort: 'createdAt asc',
        limit: 1,
        withTotal: true,
      },
    })
    .execute();

  return {
    numberOfOrders: total ?? 0,
    ...(results[0] && { firstOrderDate: results[0].createdAt.slice(0, 10) }),
  };
};
