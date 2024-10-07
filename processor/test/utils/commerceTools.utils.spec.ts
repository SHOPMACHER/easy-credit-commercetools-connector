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
});
