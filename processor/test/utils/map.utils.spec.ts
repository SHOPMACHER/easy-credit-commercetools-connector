import { mapCTCartToECPayment, mapCTCartToCTPayment } from '../../src/utils/map.utils'; // Adjust the import path as necessary
import {
  EASYCREDIT_CONNECTOR_KEY,
  EASYCREDIT_CONNECTOR_URL,
  EASYCREDIT_PAYMENT_METHOD,
  LIBRARY_NAME,
  VERSION_STRING,
} from '../../src/utils/constant.utils';
import { getCustomObjectByKey } from '../../src/commercetools/customObject.commercetools';
import { convertCentsToEur } from '../../src/utils/app.utils';
import { Cart, Payment } from '@commercetools/connect-payments-sdk';
import { ECTransaction, ECTransactionCustomerRelationship } from '../../src/types/payment.types';

jest.mock('../../src/commercetools/customObject.commercetools', () => ({
  getCustomObjectByKey: jest.fn(),
}));

jest.mock('../../src/utils/app.utils', () => ({
  convertCentsToEur: jest.fn(),
}));

describe('Payment Mapping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('mapCTCartToECPayment', () => {
    it('should map the cart and payment to ECTransaction correctly', async () => {
      const mockCart: Cart = {
        id: 'cart123',
        totalPrice: {
          centAmount: 10000,
          fractionDigits: 2,
          currencyCode: 'EUR',
        },
        lineItems: [
          {
            id: 'lineItem1',
            name: { de: 'Produkt 1' },
            quantity: 2,
            price: { value: { centAmount: 5000, fractionDigits: 2 } },
            variant: { sku: 'SKU123' },
          },
        ],
        billingAddress: {
          streetName: 'Main St',
          additionalStreetInfo: 'Apt 4B',
          postalCode: '12345',
          city: 'Berlin',
          country: 'DE',
          firstName: 'John',
          lastName: 'Doe',
        },
        shippingAddress: {
          streetName: 'Main St',
          additionalStreetInfo: '',
          postalCode: '12345',
          city: 'Berlin',
          country: 'DE',
          firstName: 'John',
          lastName: 'Doe',
        },
      } as unknown as Cart;

      const mockPayment: Payment = {
        id: 'payment123',
        // Add other necessary properties for Payment as needed
      } as unknown as Payment;

      const mockRedirectLinks = {
        urlSuccess: 'https://example.com/success',
        urlCancellation: 'https://example.com/cancel',
        urlDenial: 'https://example.com/cancel',
      };

      const mockCustomerRelationship: ECTransactionCustomerRelationship = {
        customerStatus: 'NEW_CUSTOMER',
        customerSince: '2024-01-01',
        numberOfOrders: 0,
      };

      const mockConnectorUrl = { value: 'https://example.com' };

      (getCustomObjectByKey as jest.Mock).mockResolvedValue(mockConnectorUrl);
      (convertCentsToEur as jest.Mock).mockImplementation((amount: number) => amount / 100);

      const result: ECTransaction = await mapCTCartToECPayment(
        mockCart,
        mockPayment,
        mockRedirectLinks,
        mockCustomerRelationship,
      );

      expect(getCustomObjectByKey).toHaveBeenCalledWith(EASYCREDIT_CONNECTOR_KEY, EASYCREDIT_CONNECTOR_URL);
      expect(convertCentsToEur).toHaveBeenCalledTimes(2); // Check how many times it was called
      expect(result).toEqual({
        orderDetails: {
          orderValue: 100,
          orderId: 'cart123',
          numberOfProductsInShoppingCart: 1,
          withoutFlexprice: false,
          invoiceAddress: {
            address: 'Main St',
            additionalAddressInformation: 'Apt 4B',
            zip: '12345',
            city: 'Berlin',
            country: 'DE',
            firstName: 'John',
            lastName: 'Doe',
          },
          shippingAddress: {
            address: 'Main St',
            additionalAddressInformation: '',
            zip: '12345',
            city: 'Berlin',
            country: 'DE',
            firstName: 'John',
            lastName: 'Doe',
          },
          shoppingCartInformation: [
            {
              productName: 'Produkt 1',
              quantity: 2,
              price: 50,
              articleNumber: [{ numberType: 'GTIN', number: 'SKU123' }],
            },
          ],
        },
        customer: {
          firstName: 'John',
          lastName: 'Doe',
        },
        shopsystem: {
          shopSystemManufacturer: LIBRARY_NAME, // Replace with actual value
          shopSystemModuleVersion: VERSION_STRING, // Replace with actual value
        },
        customerRelationship: mockCustomerRelationship,
        redirectLinks: {
          urlDenial: 'https://example.com/webhook/payment123/cancel?redirectUrl=https://example.com/cancel',
          urlCancellation: 'https://example.com/webhook/payment123/cancel?redirectUrl=https://example.com/cancel',
          urlSuccess: mockRedirectLinks.urlSuccess,
          urlAuthorizationCallback: 'https://example.com/webhook/payment123/authorize',
        },
        paymentType: 'INSTALLMENT_PAYMENT',
        paymentSwitchPossible: false,
      });
    });
  });

  describe('mapCTCartToCTPayment', () => {
    it('should map the cart to PaymentDraft correctly', () => {
      const mockCart: Cart = {
        id: 'cart123',
        totalPrice: {
          centAmount: 10000,
          fractionDigits: 2,
          currencyCode: 'EUR',
        },
        lineItems: [],
        billingAddress: {},
        shippingAddress: {},
      } as unknown as Cart;

      const result = mapCTCartToCTPayment(mockCart);

      expect(result).toEqual({
        amountPlanned: {
          currencyCode: 'EUR',
          centAmount: 10000,
        },
        paymentMethodInfo: {
          paymentInterface: EASYCREDIT_PAYMENT_METHOD,
          method: EASYCREDIT_PAYMENT_METHOD,
        },
      });
    });
  });
});
