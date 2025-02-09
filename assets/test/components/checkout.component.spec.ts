import { ECCheckoutComponentBuilder, ECCheckoutComponent } from '../../src/components/checkout.component';
import { WebComponentOptions, CheckoutComponentOptions } from '../../src/types/main';
import { describe, jest, it, expect, beforeEach, afterEach } from '@jest/globals';
import { findElement, importEasyCreditScript } from '../../src/utils/app.utils';

// Mock the imported utility functions
jest.mock('../../src/utils/app.utils');

// @ts-expect-error: Mock fetch globally
fetch = jest.fn() as jest.Mock;

describe('ECCheckoutComponentBuilder', () => {
  let baseOptions: WebComponentOptions;

  beforeEach(() => {
    baseOptions = {
      processorUrl: 'https://example.com',
      sessionId: 'session-id',
    };
  });

  it('should create an ECCheckoutComponent with the correct options', () => {
    const builder = new ECCheckoutComponentBuilder(baseOptions);
    const checkoutComponentOptions: CheckoutComponentOptions = {
      cartId: 'cart-id',
      redirectLinks: {
        urlSuccess: '',
        urlCancellation: '',
        urlDenial: '',
      },
      customerRelationship: {
        customerStatus: 'NEW_CUSTOMER',
        customerSince: '',
        numberOfOrders: 0,
      },
      onLoading: jest.fn(),
      onSuccess: jest.fn(),
      onError: jest.fn(),
    };

    const component = builder.build(checkoutComponentOptions);

    expect(component).toBeInstanceOf(ECCheckoutComponent);
    expect(component['checkoutComponentOptions']).toEqual(checkoutComponentOptions); // Accessing private member for testing
  });
});

describe('ECCheckoutComponent', () => {
  let component: ECCheckoutComponent;
  let baseOptions: WebComponentOptions;
  let checkoutOptions: CheckoutComponentOptions;

  beforeEach(() => {
    baseOptions = {
      processorUrl: 'https://example.com',
      sessionId: 'session-id',
    };

    checkoutOptions = {
      cartId: 'cart-id',
      redirectLinks: {
        urlSuccess: '',
        urlCancellation: '',
        urlDenial: '',
      },
      customerRelationship: {
        customerStatus: 'NEW_CUSTOMER',
        customerSince: '',
        numberOfOrders: 0,
      },
      onError: jest.fn(),
      onSuccess: jest.fn(),
      onLoading: jest.fn(),
    };

    component = new ECCheckoutComponent({
      processorUrl: baseOptions.processorUrl,
      sessionId: baseOptions.sessionId,
      checkoutComponentOptions: checkoutOptions,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should mount the component and add HTML template to the DOM', async () => {
    const mockWidget = document.createElement('div');
    document.body.appendChild(mockWidget);

    const mockResponse = { webShopId: 'shop-id', amount: 100 };
    (fetch as jest.Mock).mockImplementation(async () =>
      Promise.resolve({
        ok: true,
        // @ts-expect-error test
        json: jest.fn().mockResolvedValueOnce(mockResponse),
      }),
    );
    (importEasyCreditScript as jest.Mock).mockImplementation(() => {});
    (findElement as jest.Mock).mockReturnValue({
      insertAdjacentHTML: jest.fn().mockImplementation(() => {
        mockWidget.innerHTML = 'easycredit-checkout';
      }),
    });

    const selector = 'div'; // Select the newly created div
    await component.mount(selector);

    expect(importEasyCreditScript).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      `${baseOptions.processorUrl}/payments/payment-method/${checkoutOptions.cartId}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': baseOptions.sessionId,
        },
      },
    );

    expect(mockWidget.innerHTML).toContain('easycredit-checkout'); // Check if the template is inserted
  });

  it('should handle errors during payment method retrieval', async () => {
    (fetch as jest.Mock).mockImplementation(async () =>
      Promise.resolve({
        ok: false,
        // @ts-expect-error test
        json: jest.fn().mockResolvedValueOnce({ errors: [] }),
      }),
    );

    await expect(component.mount('div')).rejects.toThrow('Invalid WebShopId received.');
  });

  it('should submit the payment successfully', async () => {
    (fetch as jest.Mock).mockImplementation(async () =>
      Promise.resolve({
        ok: true,
        // @ts-expect-error test
        json: jest.fn().mockResolvedValueOnce({ redirectUrl: 'https://redirect.com' }),
      }),
    );

    await component.submit();

    expect(fetch).toHaveBeenCalledWith(`${baseOptions.processorUrl}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': baseOptions.sessionId,
      },
      body: JSON.stringify({
        cartId: checkoutOptions.cartId,
        redirectLinks: checkoutOptions.redirectLinks,
        customerRelationship: checkoutOptions.customerRelationship,
      }),
    });
    expect(checkoutOptions.onLoading).toHaveBeenCalledTimes(1);
    expect(checkoutOptions.onError).toHaveBeenCalledTimes(0);
    expect(checkoutOptions.onSuccess).toHaveBeenCalledWith({ redirectUrl: 'https://redirect.com' });
  });

  it('should call onError callback when the submission fails', async () => {
    const errorResponse = { error: 'Payment failed' };
    (fetch as jest.Mock).mockImplementation(async () =>
      Promise.resolve({
        ok: false,
        // @ts-expect-error test
        json: jest.fn().mockResolvedValueOnce(errorResponse),
      }),
    );

    await component.submit();

    expect(checkoutOptions.onLoading).toHaveBeenCalledTimes(1);
    expect(checkoutOptions.onError).toHaveBeenCalledWith(errorResponse);
    expect(checkoutOptions.onSuccess).toHaveBeenCalledTimes(0);
  });
});
