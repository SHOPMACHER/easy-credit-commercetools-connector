import { createApiRoot } from '../client/create.client';

// Needs the optional view_customers scope; yyyy-MM-dd of the account creation.
export const getCustomerSince = async (customerId: string): Promise<string> => {
  const { body } = await createApiRoot().customers().withId({ ID: customerId }).get().execute();

  return body.createdAt.slice(0, 10);
};
