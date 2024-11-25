import { mapCTCartToECPayment, mapCTCartToCTPayment, mapUpdateActionForRefunds } from '../../src/utils/map.utils'; // Adjust the import path as necessary
import {
  EASYCREDIT_CONNECTOR_KEY,
  EASYCREDIT_CONNECTOR_URL,
  EASYCREDIT_PAYMENT_METHOD,
  LIBRARY_NAME,
  VERSION_STRING,
} from '../../src/utils/constant.utils';
import { getCustomObjectByKey } from '../../src/commercetools/customObject.commercetools';
import { convertCentsToEur } from '../../src/utils/app.utils';
import { Cart, Payment, Transaction } from '@commercetools/connect-payments-sdk';
import {
  CTTransactionState,
  CTTransactionType,
  ECBooking,
  ECTransaction,
  ECTransactionCustomerRelationship,
} from '../../src/types/payment.types';
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

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
        customerEmail: 'john@doe.com',
        billingAddress: {
          streetName: 'Main St',
          additionalStreetInfo: 'Apt 4B',
          postalCode: '12345',
          city: 'Berlin',
          country: 'DE',
          firstName: 'John',
          lastName: 'Doe',
          phone: '',
        },
        shippingAddress: {
          streetName: 'Main St',
          additionalStreetInfo: '',
          postalCode: '12345',
          city: 'Berlin',
          country: 'DE',
          firstName: 'John',
          lastName: 'Doe',
          phone: '',
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

      // @ts-expect-error mocked
      (getCustomObjectByKey as jest.Mock).mockResolvedValue(mockConnectorUrl);

      // @ts-expect-error mocked
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
          orderId: 'payment123',
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
          contact: {
            email: 'john@doe.com',
            mobilePhoneNumber: '',
            phoneNumber: '',
            phoneNumbersConfirmed: false,
          },
        },
        shopsystem: {
          shopSystemManufacturer: LIBRARY_NAME, // Replace with actual value
          shopSystemModuleVersion: VERSION_STRING, // Replace with actual value
        },
        customerRelationship: mockCustomerRelationship,
        redirectLinks: {
          urlDenial: 'https://example.com/webhook/payment123/cancel?redirectUrl=https%3A%2F%2Fexample.com%2Fcancel',
          urlCancellation:
            'https://example.com/webhook/payment123/cancel?redirectUrl=https%3A%2F%2Fexample.com%2Fcancel',
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

  describe('mapUpdateActionForRefunds', () => {
    it('should map the update action based on valid records correctly', () => {
      const ecCompletedRefunds = [
        {
          bookingType: 'RefundBooking',
          uuid: 'b6731d8c-27d0-4a82-ac35-5d19c0a1f5c8',
          created: '2024-10-29T10:08:35+01:00',
          type: 'REFUND',
          status: 'DONE',
          message: null,
          amount: 12.0,
          bookingId: 'transaction1',
        },
        {
          bookingType: 'RefundBooking',
          uuid: 'd0ed5b26-8fe8-4b9a-a4a4-476b0c530c36',
          created: '2024-10-29T11:43:12+01:00',
          type: 'REFUND',
          status: 'FAILED',
          message: null,
          amount: 3.0,
          bookingId: 'transaction2',
        },
      ] as unknown as ECBooking[];

      const ctPendingRefunds = [
        {
          id: 'transaction1',
          type: CTTransactionType.Refund,
          state: CTTransactionState.Pending,
        },
        {
          id: 'transaction2',
          type: CTTransactionType.Refund,
          state: CTTransactionState.Pending,
        },
        {
          id: 'transaction3',
          type: CTTransactionType.Refund,
          state: CTTransactionState.Pending,
        },
      ] as Transaction[];

      const expectedResult = [
        {
          action: 'changeTransactionState',
          transactionId: ctPendingRefunds[0].id,
          state: CTTransactionState.Success,
        },
        {
          action: 'changeTransactionState',
          transactionId: ctPendingRefunds[1].id,
          state: CTTransactionState.Failure,
        },
      ];

      expect(mapUpdateActionForRefunds(ctPendingRefunds, ecCompletedRefunds)).toStrictEqual(expectedResult);
    });
  });
});
