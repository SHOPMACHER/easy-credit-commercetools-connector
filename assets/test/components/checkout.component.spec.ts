import { ECCheckoutComponentBuilder, ECCheckoutComponent } from '../../src/components/checkout.component';
import { WebComponentOptions, CheckoutComponentOptions } from '../../src/types/web-component.types';
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
        customerStatus: '',
        customerSince: '',
        numberOfOrders: 0,
      },
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
        customerStatus: '',
        customerSince: '',
        numberOfOrders: 0,
      },
      onError: jest.fn(),
    };

    component = new ECCheckoutComponent({
      processorUrl: baseOptions.processorUrl,
      sessionId: baseOptions.sessionId,
      checkoutComponentOptions: checkoutOptions,
    });

    // Mock window.location.replace
    delete window.location; // Delete the existing window.location
    // @ts-expect-error test
    window.location = { replace: jest.fn() }; // Mock the replace method
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should mount the component and add HTML template to the DOM', async () => {
    const mockElement = document.createElement('div');
    document.body.appendChild(mockElement);

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
        mockElement.innerHTML = 'easycredit-checkout';
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
    expect(mockElement.innerHTML).toContain('easycredit-checkout'); // Check if the template is inserted
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
    expect(window.location.replace).toHaveBeenCalledWith('https://redirect.com');
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

    expect(checkoutOptions.onError).toHaveBeenCalledWith(errorResponse);
  });
});
