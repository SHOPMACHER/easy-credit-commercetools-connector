import { Cart, Errorx, MultiErrorx } from '@commercetools/connect-payments-sdk';
import { getCartById } from '../../src/commercetools/cart.commercetools';
import { readConfiguration } from '../../src/utils/config.utils';
import { validateAddresses, validateCartAmount, validateCurrency } from '../../src/validators/payment.validators';
import { handlePaymentMethod } from '../../src/services/payment.service';
import { log } from '../../src/libs/logger';

jest.mock('../../src/commercetools/cart.commercetools', () => ({
  getCartById: jest.fn(),
}));

jest.mock('../../src/utils/config.utils', () => ({
  readConfiguration: jest.fn(),
}));

jest.mock('../../src/validators/payment.validators', () => ({
  validateAddresses: jest.fn(),
  validateCurrency: jest.fn(),
  validateCartAmount: jest.fn(),
}));

jest.mock('../../src/libs/logger', () => ({
  log: {
    error: jest.fn(),
  },
}));

describe('handlePaymentMethod', () => {
  const mockCart = {
    billingAddress: { country: 'DE' },
    shippingAddress: { country: 'DE' },
    totalPrice: { centAmount: 10000, fractionDigits: 2, currencyCode: 'EUR' },
  } as Cart;

  const mockConfig = { easyCredit: { webShopId: 'dummyWebShopId' } };

  beforeEach(() => {
    (getCartById as jest.Mock).mockResolvedValue(mockCart);
    (readConfiguration as jest.Mock).mockReturnValue(mockConfig);
  });

  it('should return ecConfig when no validation errors', async () => {
    const result = await handlePaymentMethod('valid-cart-id');
    expect(result).toEqual({ webShopId: 'dummyWebShopId' });

    expect(validateAddresses).toHaveBeenCalledWith(
      mockCart.billingAddress,
      mockCart.shippingAddress,
      mockConfig.easyCredit,
      [],
    );
    expect(validateCurrency).toHaveBeenCalledWith(mockCart.totalPrice.currencyCode, mockConfig.easyCredit, []);
    expect(validateCartAmount).toHaveBeenCalledWith(
      mockCart.totalPrice.centAmount,
      mockCart.totalPrice.fractionDigits,
      mockConfig.easyCredit,
      [],
    );
  });

  it('should throw MultiErrorx if there are validation errors', async () => {
    const validationErrors = [
      new Errorx({ code: 'InvalidCurrency', httpErrorStatus: 400, message: 'Currency error', fields: {} }),
    ];

    (validateAddresses as jest.Mock).mockImplementation((_, __, ___, errors) => {
      errors.push(...validationErrors);
    });

    await expect(handlePaymentMethod('invalid-cart-id')).rejects.toThrow(MultiErrorx);

    expect(validateAddresses).toHaveBeenCalled();
    expect(validateCurrency).toHaveBeenCalled();
    expect(validateCartAmount).toHaveBeenCalled();
  });

  it('should log error and rethrow if getCartById fails', async () => {
    const mockError = new Error('Cart retrieval failed');
    (getCartById as jest.Mock).mockRejectedValue(mockError);

    await expect(handlePaymentMethod('invalid-cart-id')).rejects.toThrow(mockError);

    expect(log.error).toHaveBeenCalledWith('Error in getting EasyCredit Payment Method', mockError);
  });

  it('should log error and rethrow if validation throws unexpected error', async () => {
    const mockError = new Error('Unexpected validation error');
    (validateAddresses as jest.Mock).mockImplementation(() => {
      throw mockError;
    });

    await expect(handlePaymentMethod('invalid-cart-id')).rejects.toThrow(mockError);

    expect(log.error).toHaveBeenCalledWith('Error in getting EasyCredit Payment Method', mockError);
  });
});
