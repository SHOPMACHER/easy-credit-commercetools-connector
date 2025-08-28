import {
  getShippingAddress,
  mapAddress,
  mapCTCartToCTPayment,
  mapCTCartToECPayment,
  mapLineItem,
  mapUpdateActionForRefunds,
} from '../../src/utils/map.utils'; // Adjust the import path as necessary
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
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Address } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/common';
import { LineItem } from '@commercetools/connect-payments-sdk';

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
          streetNumber: '55',
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
          streetNumber: '55',
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
            address: 'Main St 55',
            additionalAddressInformation: 'Apt 4B',
            zip: '12345',
            city: 'Berlin',
            country: 'DE',
            firstName: 'John',
            lastName: 'Doe',
          },
          shippingAddress: {
            address: 'Main St 55',
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
            phoneNumbersConfirmed: true,
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

  describe('mapAddress', () => {
    const mockCompleteAddress: Address = {
      streetName: 'Musterstraße',
      streetNumber: '123',
      additionalStreetInfo: 'Apartment 4B',
      postalCode: '12345',
      city: 'Berlin',
      country: 'DE',
      firstName: 'John',
      lastName: 'Doe',
    };

    it('should map complete address correctly', () => {
      const result = mapAddress(mockCompleteAddress);

      expect(result).toEqual({
        address: 'Musterstraße 123',
        additionalAddressInformation: 'Apartment 4B',
        zip: '12345',
        city: 'Berlin',
        country: 'DE',
        firstName: 'John',
        lastName: 'Doe',
      });
    });

    it('should handle missing street name with empty string', () => {
      const addressWithoutStreetName: Address = {
        ...mockCompleteAddress,
        streetName: undefined,
      };

      const result = mapAddress(addressWithoutStreetName);

      expect(result.address).toBe(' 123');
      expect(result.city).toBe('Berlin'); // Verify other fields are preserved
    });

    it('should handle missing street number with empty string', () => {
      const addressWithoutStreetNumber: Address = {
        ...mockCompleteAddress,
        streetNumber: undefined,
      };

      const result = mapAddress(addressWithoutStreetNumber);

      expect(result.address).toBe('Musterstraße ');
      expect(result.city).toBe('Berlin'); // Verify other fields are preserved
    });

    it('should handle missing both street name and number', () => {
      const addressWithoutStreetInfo: Address = {
        ...mockCompleteAddress,
        streetName: undefined,
        streetNumber: undefined,
      };

      const result = mapAddress(addressWithoutStreetInfo);

      expect(result.address).toBe(' ');
    });

    it('should use empty strings for missing optional fields', () => {
      const minimalAddress: Address = {
        streetName: 'Main Street',
        streetNumber: '1',
        country: 'DE', // Required field
      };

      const result = mapAddress(minimalAddress);

      expect(result).toEqual({
        address: 'Main Street 1',
        additionalAddressInformation: '',
        zip: '',
        city: '',
        country: 'DE',
        firstName: '',
        lastName: '',
      });
    });

    it('should handle null values correctly', () => {
      const addressWithNulls: Address = {
        streetName: null as any,
        streetNumber: null as any,
        additionalStreetInfo: null as any,
        postalCode: null as any,
        city: null as any,
        country: 'DE', // Required field
        firstName: null as any,
        lastName: null as any,
      };

      const result = mapAddress(addressWithNulls);

      expect(result).toEqual({
        address: ' ',
        additionalAddressInformation: '',
        zip: '',
        city: '',
        country: 'DE',
        firstName: '',
        lastName: '',
      });
    });

    it('should handle address with special characters', () => {
      const addressWithSpecialChars: Address = {
        streetName: 'Straße-Ñame',
        streetNumber: '123/A',
        additionalStreetInfo: 'Étage 2',
        postalCode: 'D-12345',
        city: 'München',
        country: 'DE',
        firstName: 'José',
        lastName: "O'Connor",
      };

      const result = mapAddress(addressWithSpecialChars);

      expect(result).toEqual({
        address: 'Straße-Ñame 123/A',
        additionalAddressInformation: 'Étage 2',
        zip: 'D-12345',
        city: 'München',
        country: 'DE',
        firstName: 'José',
        lastName: "O'Connor",
      });
    });

    it('should handle addresses with only street name', () => {
      const addressOnlyStreetName: Address = {
        streetName: 'Lonely Street',
        country: 'DE',
      };

      const result = mapAddress(addressOnlyStreetName);

      expect(result.address).toBe('Lonely Street ');
      expect(result.additionalAddressInformation).toBe('');
      expect(result.country).toBe('DE');
    });

    it('should handle undefined lastName specifically', () => {
      const addressWithoutLastName = {
        streetName: 'Test St',
        streetNumber: '123',
        postalCode: '12345',
        city: 'Test City',
        country: 'DE',
        firstName: 'John',
        // lastName property completely omitted to trigger nullish coalescing
      } as Address;

      const result = mapAddress(addressWithoutLastName);

      expect(result.lastName).toBe(''); // Should fallback to empty string
      expect(result.firstName).toBe('John'); // Other fields should remain
    });

    it('should handle undefined firstName specifically', () => {
      const addressWithoutFirstName = {
        streetName: 'Test St',
        streetNumber: '123',
        postalCode: '12345',
        city: 'Test City',
        country: 'DE',
        lastName: 'Doe',
        // firstName property completely omitted to trigger nullish coalescing on line 32
      } as Address;

      const result = mapAddress(addressWithoutFirstName);

      expect(result.firstName).toBe(''); // Should fallback to empty string - THIS IS LINE 32
      expect(result.lastName).toBe('Doe'); // Other fields should remain
    });

    it('should handle completely undefined address object', () => {
      const result = mapAddress(undefined as any);

      expect(result.lastName).toBe(''); // Should fallback to empty string when address is undefined
      expect(result.firstName).toBe(''); // All fields should fallback
    });
  });

  describe('mapLineItem', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    const mockCompleteLineItem: LineItem = {
      id: 'lineitem-123',
      name: {
        de: 'Deutsches Produkt',
        'de-DE': 'German Product',
        en: 'English Product',
      },
      quantity: 2,
      price: {
        value: {
          centAmount: 5000,
          fractionDigits: 2,
          currencyCode: 'EUR',
        },
      },
      variant: {
        sku: 'SKU-12345',
      },
    } as unknown as LineItem;

    it('should map complete line item correctly', () => {
      (convertCentsToEur as jest.Mock).mockReturnValue(50); // 5000 / 100

      const result = mapLineItem(mockCompleteLineItem);

      expect(convertCentsToEur).toHaveBeenCalledWith(5000, 2);
      expect(result).toEqual({
        productName: 'Deutsches Produkt',
        quantity: 2,
        price: 50, // 5000 / 100
        articleNumber: [
          {
            numberType: 'GTIN',
            number: 'SKU-12345',
          },
        ],
      });
    });

    it('should fallback to de-DE when de is not available', () => {
      (convertCentsToEur as jest.Mock).mockReturnValue(50);

      const lineItemWithoutDe: LineItem = {
        ...mockCompleteLineItem,
        name: {
          'de-DE': 'German Product Fallback',
          en: 'English Product',
        },
      };

      const result = mapLineItem(lineItemWithoutDe);

      expect(result.productName).toBe('German Product Fallback');
    });

    it('should handle missing name properties gracefully', () => {
      (convertCentsToEur as jest.Mock).mockReturnValue(50);

      const lineItemWithoutNames: LineItem = {
        ...mockCompleteLineItem,
        name: {} as any,
      };

      const result = mapLineItem(lineItemWithoutNames);

      expect(result.productName).toBeUndefined();
      expect(result.quantity).toBe(2);
    });

    it('should handle undefined variant sku', () => {
      (convertCentsToEur as jest.Mock).mockReturnValue(50);

      const lineItemWithoutSku: LineItem = {
        ...mockCompleteLineItem,
        variant: {
          sku: undefined,
        },
      } as unknown as LineItem;

      const result = mapLineItem(lineItemWithoutSku);

      expect(result.articleNumber).toEqual([
        {
          numberType: 'GTIN',
          number: undefined,
        },
      ]);
    });

    it('should handle zero quantity', () => {
      (convertCentsToEur as jest.Mock).mockReturnValue(50);

      const lineItemZeroQuantity: LineItem = {
        ...mockCompleteLineItem,
        quantity: 0,
      };

      const result = mapLineItem(lineItemZeroQuantity);

      expect(result.quantity).toBe(0);
      expect(result.productName).toBe('Deutsches Produkt');
    });

    it('should handle high precision prices', () => {
      (convertCentsToEur as jest.Mock).mockReturnValue(123.456); // 123456 / 1000

      const lineItemHighPrecision: LineItem = {
        ...mockCompleteLineItem,
        price: {
          value: {
            centAmount: 123456,
            fractionDigits: 3,
            currencyCode: 'EUR',
          },
        },
      } as unknown as LineItem;

      const result = mapLineItem(lineItemHighPrecision);

      expect(convertCentsToEur).toHaveBeenCalledWith(123456, 3);
      expect(result.price).toBe(123.456); // 123456 / 1000
    });

    it('should handle zero price', () => {
      (convertCentsToEur as jest.Mock).mockReturnValue(0); // 0 / 100

      const lineItemZeroPrice: LineItem = {
        ...mockCompleteLineItem,
        price: {
          value: {
            centAmount: 0,
            fractionDigits: 2,
            currencyCode: 'EUR',
          },
        },
      } as unknown as LineItem;

      const result = mapLineItem(lineItemZeroPrice);

      expect(convertCentsToEur).toHaveBeenCalledWith(0, 2);
      expect(result.price).toBe(0);
    });

    it('should handle special characters in product name', () => {
      (convertCentsToEur as jest.Mock).mockReturnValue(50);

      const lineItemSpecialChars: LineItem = {
        ...mockCompleteLineItem,
        name: {
          de: 'Spëcïal Prödüct & More™',
          'de-DE': 'Special Product & More',
        },
      };

      const result = mapLineItem(lineItemSpecialChars);

      expect(result.productName).toBe('Spëcïal Prödüct & More™');
    });

    it('should handle special characters in SKU', () => {
      (convertCentsToEur as jest.Mock).mockReturnValue(50);

      const lineItemSpecialSku: LineItem = {
        ...mockCompleteLineItem,
        variant: {
          sku: 'SKU-123/ABC_XYZ.001',
        },
      } as unknown as LineItem;

      const result = mapLineItem(lineItemSpecialSku);

      expect(result.articleNumber[0].number).toBe('SKU-123/ABC_XYZ.001');
    });

    it('should handle large quantities', () => {
      (convertCentsToEur as jest.Mock).mockReturnValue(50);

      const lineItemLargeQuantity: LineItem = {
        ...mockCompleteLineItem,
        quantity: 999,
      };

      const result = mapLineItem(lineItemLargeQuantity);

      expect(result.quantity).toBe(999);
    });

    it('should always use GTIN as numberType', () => {
      (convertCentsToEur as jest.Mock).mockReturnValue(50);

      const result = mapLineItem(mockCompleteLineItem);

      expect(result.articleNumber).toHaveLength(1);
      expect(result.articleNumber[0].numberType).toBe('GTIN');
    });

    it('should handle minimal line item structure', () => {
      (convertCentsToEur as jest.Mock).mockReturnValue(1); // 100 / 100

      const minimalLineItem: LineItem = {
        name: { de: 'Minimal Product' },
        quantity: 1,
        price: {
          value: {
            centAmount: 100,
            fractionDigits: 2,
            currencyCode: 'EUR',
          },
        },
        variant: {
          sku: 'MIN-001',
        },
      } as unknown as LineItem;

      const result = mapLineItem(minimalLineItem);

      expect(result).toEqual({
        productName: 'Minimal Product',
        quantity: 1,
        price: 1, // 100 / 100
        articleNumber: [
          {
            numberType: 'GTIN',
            number: 'MIN-001',
          },
        ],
      });
    });
  });

  describe('getShippingAddress', () => {
    it('should return cart.shippingAddress when shippingMode is not Multiple', () => {
      const mockCart: Cart = {
        shippingMode: 'Single',
        shippingAddress: {
          streetName: 'Main St',
          streetNumber: '55',
          postalCode: '12345',
          city: 'Berlin',
          country: 'DE',
          firstName: 'John',
          lastName: 'Doe',
        },
      } as unknown as Cart;

      const result = getShippingAddress(mockCart);

      expect(result).toEqual(mockCart.shippingAddress);
    });

    it('should return first shipping address when shippingMode is Multiple', () => {
      const mockShippingAddress = {
        streetName: 'First Address St',
        streetNumber: '55',
        postalCode: '54321',
        city: 'Munich',
        country: 'DE',
        firstName: 'Jane',
        lastName: 'Smith',
      };

      const mockCart: Cart = {
        shippingMode: 'Multiple',
        shipping: [
          {
            shippingAddress: mockShippingAddress,
          },
          {
            shippingAddress: {
              streetName: 'Second Address St',
              streetNumber: '55',
              postalCode: '67890',
              city: 'Hamburg',
              country: 'DE',
              firstName: 'Bob',
              lastName: 'Wilson',
            },
          },
        ],
      } as unknown as Cart;

      const result = getShippingAddress(mockCart);

      expect(result).toEqual(mockShippingAddress);
    });

    it('should return undefined when shippingMode is Multiple but shipping array is empty', () => {
      const mockCart: Cart = {
        shippingMode: 'Multiple',
        shipping: [],
      } as unknown as Cart;

      const result = getShippingAddress(mockCart);

      expect(result).toBeUndefined();
    });

    it('should return undefined when shippingMode is Multiple but shipping is undefined', () => {
      const mockCart: Cart = {
        shippingMode: 'Multiple',
        shipping: undefined,
      } as unknown as Cart;

      const result = getShippingAddress(mockCart);

      expect(result).toBeUndefined();
    });

    it('should return undefined when shippingMode is Multiple but first shipping entry has no shippingAddress', () => {
      const mockCart: Cart = {
        shippingMode: 'Multiple',
        shipping: [
          {
            shippingAddress: undefined,
          },
        ],
      } as unknown as Cart;

      const result = getShippingAddress(mockCart);

      expect(result).toBeUndefined();
    });

    it('should return undefined when cart has no shippingAddress for single mode', () => {
      const mockCart: Cart = {
        shippingMode: 'Single',
        shippingAddress: undefined,
      } as unknown as Cart;

      const result = getShippingAddress(mockCart);

      expect(result).toBeUndefined();
    });

    it('should handle undefined shippingMode gracefully', () => {
      const mockCart: Cart = {
        shippingMode: undefined,
        shippingAddress: {
          streetName: 'Default St',
          streetNumber: '55',
          postalCode: '11111',
          city: 'Default City',
          country: 'DE',
          firstName: 'Default',
          lastName: 'User',
        },
      } as unknown as Cart;

      const result = getShippingAddress(mockCart);

      expect(result).toEqual(mockCart.shippingAddress);
    });
  });
});
