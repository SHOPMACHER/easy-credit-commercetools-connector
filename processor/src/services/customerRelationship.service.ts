import { Cart } from '@commercetools/connect-payments-sdk';
import { getCustomerSince } from '../commercetools/customer.commercetools';
import { CustomerOrderHistory, getOrderHistoryOfCustomer } from '../commercetools/order.commercetools';
import { log } from '../libs/logger';
import { ECTransactionCustomerRelationship } from '../types/payment.types';

const isMissingScope = (error: unknown): boolean => (error as { statusCode?: number })?.statusCode === 403;

const readCustomerSince = (cartId: string, customerId: string): Promise<string | undefined> =>
  getCustomerSince(customerId).catch((error: unknown) => {
    // Without the optional view_customers scope every logged-in create ends here, so it is not a warning.
    if (isMissingScope(error)) {
      log.debug('No view_customers scope, using the first order date as customerSince', { cartId });
    } else {
      log.warn('Failed to read the customer, using the first order date as customerSince', { cartId, error });
    }
    return undefined;
  });

const readOrderHistory = (cartId: string, customerId: string): Promise<CustomerOrderHistory | undefined> =>
  getOrderHistoryOfCustomer(customerId).catch((error: unknown) => {
    log.warn('Failed to read the orders of the customer, sending 0 orders', { cartId, error });
    return undefined;
  });

// Built like TeamBank's own shop plugins, but from commercetools only: the request comes from the shopper's browser.
// A guest has no history: an order count by email would let anyone borrow another shopper's history.
export const getCustomerRelationship = async (cart: Cart): Promise<ECTransactionCustomerRelationship> => {
  if (!cart.customerId) {
    return { orderDoneWithLogin: false, numberOfOrders: 0 };
  }

  const [accountDate, orders] = await Promise.all([
    readCustomerSince(cart.id, cart.customerId),
    readOrderHistory(cart.id, cart.customerId),
  ]);

  // easyCredit rejects a login order without customerSince. The fallbacks are never earlier than the account date,
  // so they cannot make the relationship look longer than it is.
  const customerSince = accountDate ?? orders?.firstOrderDate ?? new Date().toISOString().slice(0, 10);

  return { orderDoneWithLogin: true, numberOfOrders: orders?.numberOfOrders ?? 0, customerSince };
};
