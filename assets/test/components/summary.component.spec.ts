import { ECSummaryComponent, ECSummaryComponentBuilder } from '../../src/components/summary.component';
import { findElement, importEasyCreditScript } from '../../src/utils/app.utils';
import { WebComponentOptions, SummaryComponentOptions } from '../../src/types/web-component.types';
import { describe, jest, it, expect, beforeEach } from '@jest/globals';

// Mock the imported utility functions
jest.mock('../../src/utils/app.utils');

// @ts-expect-error: Mock fetch globally
fetch = jest.fn() as jest.Mock;

describe('ECSummaryComponent', () => {
  const baseOptions: WebComponentOptions = {
    processorUrl: 'https://test-processor.com',
    sessionId: 'session123',
  };

  const summaryComponentOptions: SummaryComponentOptions = {
    paymentId: 'payment123',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ECSummaryComponentBuilder', () => {
    it('should build an ECSummaryComponent with correct options', () => {
      const builder = new ECSummaryComponentBuilder(baseOptions);
      const component = builder.build(summaryComponentOptions);

      expect(component).toBeInstanceOf(ECSummaryComponent);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((component as any).processorUrl).toBe(baseOptions.processorUrl);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((component as any).sessionId).toBe(baseOptions.sessionId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((component as any).summaryComponentOptions).toBe(summaryComponentOptions);
    });
  });

  describe('ECSummaryComponent', () => {
    let component: ECSummaryComponent;

    beforeEach(() => {
      component = new ECSummaryComponent({
        processorUrl: baseOptions.processorUrl,
        sessionId: baseOptions.sessionId,
        summaryComponentOptions,
      });
    });

    it('should mount the component and render template', async () => {
      const mockPaymentResponse = {
        webShopId: 'shop123',
        amount: 100,
        status: 'success',
        decision: {
          interest: 5,
          totalValue: 105,
          orderValue: 100,
          decisionOutcome: 'APPROVED',
          numberOfInstallments: 3,
          installment: 35,
          lastInstallment: 35,
          mtan: { required: false, successful: true },
          bankAccountCheck: { required: false },
        },
      };

      // Mocking the fetch and utility functions
      (fetch as jest.Mock).mockImplementation(async () =>
        Promise.resolve({
          ok: true,
          // @ts-expect-error test
          json: jest.fn().mockResolvedValueOnce(mockPaymentResponse),
        }),
      );

      (findElement as jest.Mock).mockReturnValue({
        insertAdjacentHTML: jest.fn(),
      });

      await component.mount('#selector');

      // Check if importEasyCreditScript is called
      expect(importEasyCreditScript).toHaveBeenCalled();

      // Check if fetch was called with the correct URL and headers
      expect(fetch).toHaveBeenCalledWith(`${baseOptions.processorUrl}/payments/${summaryComponentOptions.paymentId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': baseOptions.sessionId,
        },
      });

      // Check if template was generated and inserted
      const expectedTemplate = `
      <easycredit-checkout-label payment-type="INSTALLMENT" />
      <easycredit-checkout 
        webshop-id="shop123" 
        amount="100"
        payment-plan="{&quot;interest&quot;:5,&quot;totalValue&quot;:105,&quot;orderValue&quot;:100,&quot;decisionOutcome&quot;:&quot;APPROVED&quot;,&quot;numberOfInstallments&quot;:3,&quot;installment&quot;:35,&quot;lastInstallment&quot;:35,&quot;mtan&quot;:{&quot;required&quot;:false,&quot;successful&quot;:true},&quot;bankAccountCheck&quot;:{&quot;required&quot;:false}}"
        is-active="true" 
        payment-type="INSTALLMENT" 
        alert="" 
      />
    `;
      expect(findElement).toHaveBeenCalledWith('#selector');
      expect(findElement('#selector').insertAdjacentHTML).toHaveBeenCalledWith('afterbegin', expectedTemplate);
    });

    it('should handle payment error response and render error message', async () => {
      const mockErrorResponse = {
        statusCode: 400,
        message: 'Payment failed',
        errors: [{ code: 'ERR_PAYMENT', message: 'Invalid payment' }],
      };

      (fetch as jest.Mock).mockImplementation(async () =>
        Promise.resolve({
          ok: false,
          // @ts-expect-error test
          json: jest.fn().mockResolvedValueOnce(mockErrorResponse),
        }),
      );
      (findElement as jest.Mock).mockReturnValue({
        insertAdjacentHTML: jest.fn(),
      });

      await component.mount('#selector');

      const expectedTemplate = `
      <easycredit-checkout-label payment-type="INSTALLMENT" />
      <easycredit-checkout 
        webshop-id="" 
        amount="0"
        payment-plan=""
        is-active="true" 
        payment-type="INSTALLMENT" 
        alert="Invalid payment" 
      />
    `;
      expect(findElement('#selector').insertAdjacentHTML).toHaveBeenCalledWith('afterbegin', expectedTemplate);
    });
  });
});
