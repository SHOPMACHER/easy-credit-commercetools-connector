import { compareAddress } from './../../src/utils/commerceTools.utils';
import { describe, expect, it } from '@jest/globals';
import { Address } from '@commercetools/connect-payments-sdk';

describe('test compareAddress', () => {
  it('should return false if at least property is unmatched', () => {
    const billingAddress: Address = {
      firstName: 'john',
      lastName: 'doe',
      streetName: 'dummy',
      country: 'DE',
    };

    const shippingAddress: Address = {
      firstName: 'john',
      lastName: 'doe',
      streetName: 'dummy1',
      country: 'DE',
      city: 'lorem',
    };

    expect(compareAddress(billingAddress, shippingAddress)).toBeFalsy();
  });

  it('should return false if at least property is unmatched', () => {
    const billingAddress: Address = {
      firstName: 'john',
      lastName: 'doe',
      streetName: 'dummy',
      country: 'DE',
      city: 'lorem',
    };

    const shippingAddress: Address = {
      firstName: 'john',
      lastName: 'doe',
      streetName: 'dummy',
      country: 'DE',
      city: 'lorem',
    };

    expect(compareAddress(billingAddress, shippingAddress)).toBeTruthy();
  });

  describe('additionalStreetInfo', () => {
    const address: Address = {
      firstName: 'john',
      lastName: 'doe',
      streetName: 'dummy',
      country: 'DE',
      city: 'lorem',
    };

    it('should return false if only additionalStreetInfo differs', () => {
      expect(compareAddress(address, { ...address, additionalStreetInfo: 'c/o doe' })).toBeFalsy();
    });

    it('should treat a missing and an empty additionalStreetInfo as equal', () => {
      expect(compareAddress(address, { ...address, additionalStreetInfo: '' })).toBeTruthy();
    });

    it('should return true if additionalStreetInfo matches', () => {
      expect(
        compareAddress({ ...address, additionalStreetInfo: '3. OG' }, { ...address, additionalStreetInfo: '3. OG' }),
      ).toBeTruthy();
    });
  });
});
