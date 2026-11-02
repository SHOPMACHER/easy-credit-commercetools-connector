import { describe, expect, it } from '@jest/globals';
import { Cart } from '@commercetools/connect-payments-sdk';
import { mapAddress, mapCTCartToECUpdate, mapECAddressToCTAddress, splitStreet } from '../../src/utils/map.utils';

describe('express return mappers', () => {
  describe('splitStreet', () => {
    it.each([
      ['Beuthener Str. 25', { streetName: 'Beuthener Str.', streetNumber: '25' }],
      ['Hauptstr. 25a', { streetName: 'Hauptstr.', streetNumber: '25a' }],
      ['Am Markt 3-5', { streetName: 'Am Markt', streetNumber: '3-5' }],
      ['Gartenweg 12/1', { streetName: 'Gartenweg', streetNumber: '12/1' }],
      ['Straße des 17. Juni 5', { streetName: 'Straße des 17. Juni', streetNumber: '5' }],
      ['  Lange   Reihe   7  ', { streetName: 'Lange Reihe', streetNumber: '7' }],
      ['Musterweg 12 b', { streetName: 'Musterweg 12 b' }],
      ['Postfach', { streetName: 'Postfach' }],
      ['25', { streetName: '25' }],
    ])('should split %p', (address, expected) => {
      expect(splitStreet(address)).toEqual(expected);
    });

    it('should give mapAddress back the same line', () => {
      expect(mapAddress({ country: 'DE', ...splitStreet('Beuthener Str. 25') }).address).toBe('Beuthener Str. 25');
    });
  });

  describe('mapECAddressToCTAddress', () => {
    const customer = {
      firstName: 'Customer',
      lastName: 'Name',
      contact: { email: 'ralf@example.com', mobilePhoneNumber: '+491712345678' },
    };

    it('should take over name, phone and address but no email', () => {
      expect(
        mapECAddressToCTAddress(
          {
            firstName: 'Ralf',
            lastName: 'Ratenkauf',
            address: 'Beuthener Str. 25',
            additionalAddressInformation: 'Hinterhaus',
            zip: '90471',
            city: 'Nürnberg',
            country: 'DE',
          },
          customer,
        ),
      ).toEqual({
        firstName: 'Ralf',
        lastName: 'Ratenkauf',
        streetName: 'Beuthener Str.',
        streetNumber: '25',
        additionalStreetInfo: 'Hinterhaus',
        postalCode: '90471',
        city: 'Nürnberg',
        country: 'DE',
        phone: '+491712345678',
        mobile: '+491712345678',
      });
    });

    it('should fall back to the customer name and leave empty values out', () => {
      const address = mapECAddressToCTAddress(
        { address: 'Postfach', additionalAddressInformation: '', zip: '90471', city: 'Nürnberg', country: 'DE' },
        { ...customer, contact: null },
      );

      expect(address).toMatchObject({ firstName: 'Customer', lastName: 'Name', streetName: 'Postfach' });
      expect(address.additionalStreetInfo).toBeUndefined();
      expect(address.phone).toBeUndefined();
    });
  });

  describe('mapCTCartToECUpdate', () => {
    it('should map the parts of the order details that PATCH can change', () => {
      const cart = {
        totalPrice: { centAmount: 50495, fractionDigits: 2, currencyCode: 'EUR' },
        lineItems: [
          {
            name: { de: 'Stuhl' },
            quantity: 2,
            price: { value: { centAmount: 25000, fractionDigits: 2 } },
            variant: { sku: 'sku-1' },
          },
        ],
      } as unknown as Cart;

      expect(mapCTCartToECUpdate(cart)).toEqual({
        orderValue: 504.95,
        numberOfProductsInShoppingCart: 1,
        shoppingCartInformation: [
          { productName: 'Stuhl', quantity: 2, price: 250, articleNumber: [{ numberType: 'GTIN', number: 'sku-1' }] },
        ],
      });
    });
  });
});
