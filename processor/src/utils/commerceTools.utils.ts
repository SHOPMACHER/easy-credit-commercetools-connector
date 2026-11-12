import { Address } from '@commercetools/connect-payments-sdk';

export const compareAddress = (addr1: Address, addr2: Address): boolean => {
  if (
    addr1.email !== addr2.email ||
    addr1.firstName !== addr2.firstName ||
    addr1.lastName !== addr2.lastName ||
    addr1.phone !== addr2.phone ||
    addr1.mobile !== addr2.mobile ||
    addr1.streetName !== addr2.streetName ||
    addr1.streetNumber !== addr2.streetNumber ||
    // Sent to easyCredit as additionalAddressInformation, which its own address check compares too.
    (addr1.additionalStreetInfo ?? '') !== (addr2.additionalStreetInfo ?? '') ||
    addr1.postalCode !== addr2.postalCode ||
    addr1.city !== addr2.city ||
    addr1.country !== addr2.country
  ) {
    return false;
  }

  return true;
};
