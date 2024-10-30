import { readConfiguration } from '../utils/config.utils';
import { EASYCREDIT_BASE_API_URL, EASYCREDIT_PARTNER_BASE_API_URL } from '../utils/constant.utils';
import {
  ECCreatePaymentResponse,
  ECGetPaymentResponse,
  ECRefundPayload,
  ECTransaction,
  ECTransactionError,
} from '../types/payment.types';
import { Errorx } from '@commercetools/connect-payments-sdk';
import { log } from '../libs/logger';

interface EasyCreditConfig {
  webShopId: string;
  apiPassword: string;
}

interface EasyCreditClient {
  integrationCheck(payload: object, customHeaders?: HeadersInit): Promise<boolean>;
  createPayment(payload: ECTransaction, customHeaders?: HeadersInit): Promise<ECCreatePaymentResponse>;
  authorizePayment(technicalTransactionId: string, orderId: string, customHeaders?: HeadersInit): Promise<boolean>;
  capturePayment(
    transactionId: string,
    orderId: string,
    trackingNumber?: string,
    customHeaders?: HeadersInit,
  ): Promise<boolean>;
  getPayment(technicalTransactionId: string, customHeaders?: HeadersInit): Promise<ECGetPaymentResponse>;
  refundPayment(transactionId: string, payload: ECRefundPayload, customHeaders?: HeadersInit): Promise<boolean>;
}

class EasyCreditApiClient implements EasyCreditClient {
  private readonly baseApiUrl: string;
  private readonly partnerBaseApiUrl: string;
  private readonly config: EasyCreditConfig;

  constructor(
    config: EasyCreditConfig,
    baseApiUrl = EASYCREDIT_BASE_API_URL,
    partnerBaseApiUrl = EASYCREDIT_PARTNER_BASE_API_URL,
  ) {
    this.config = config;
    this.baseApiUrl = baseApiUrl;
    this.partnerBaseApiUrl = partnerBaseApiUrl;
  }

  private getDefaultHeaders(): HeadersInit {
    const authString = btoa(`${this.config.webShopId}:${this.config.apiPassword}`);
    return {
      'Content-Type': 'application/json',
      Authorization: `Basic ${authString}`,
    };
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const errorData: ECTransactionError = await response.json();
      log.error('EasyCredit API error', errorData);
      throw new Errorx({
        code: errorData.title || 'Unknown Error',
        message: errorData.title || 'An error occurred',
        httpErrorStatus: response.status,
        fields: errorData.violations,
      });
    }
    return response.json();
  }

  public async integrationCheck(payload: object, customHeaders?: HeadersInit): Promise<boolean> {
    const headers = { ...this.getDefaultHeaders(), ...customHeaders };
    const response = await fetch(`${this.baseApiUrl}/payment/v3/webshop/integrationcheck`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    await this.handleResponse(response);

    return true;
  }

  public async createPayment(payload: ECTransaction, customHeaders?: HeadersInit): Promise<ECCreatePaymentResponse> {
    const headers = { ...this.getDefaultHeaders(), ...customHeaders };
    const response = await fetch(`${this.baseApiUrl}/payment/v3/transaction`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    return this.handleResponse(response);
  }

  public async authorizePayment(
    technicalTransactionId: string,
    orderId: string,
    customHeaders?: HeadersInit,
  ): Promise<boolean> {
    const headers = { ...this.getDefaultHeaders(), ...customHeaders };
    const response = await fetch(`${this.baseApiUrl}/payment/v3/transaction/${technicalTransactionId}/authorization`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ orderId }),
    });
    await this.handleResponse(response);

    return true;
  }

  public async capturePayment(
    transactionId: string,
    orderId: string,
    trackingNumber?: string,
    customHeaders?: HeadersInit,
  ): Promise<boolean> {
    const headers = { ...this.getDefaultHeaders(), ...customHeaders };
    const body = { orderId, trackingNumber };
    const response = await fetch(`${this.baseApiUrl}/api/merchant/v3/transaction/${transactionId}/capture`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    await this.handleResponse(response);

    return true;
  }

  public async getPayment(technicalTransactionId: string, customHeaders?: HeadersInit): Promise<ECGetPaymentResponse> {
    const headers = { ...this.getDefaultHeaders(), ...customHeaders };
    const response = await fetch(`${this.baseApiUrl}/payment/v3/transaction/${technicalTransactionId}`, {
      method: 'GET',
      headers,
    });
    return this.handleResponse(response);
  }

  public async refundPayment(
    transactionId: string,
    payload: ECRefundPayload,
    customHeaders?: HeadersInit,
  ): Promise<boolean> {
    try {
      const headers: HeadersInit = { ...this.getDefaultHeaders(), ...customHeaders };

      const response = await fetch(`${this.partnerBaseApiUrl}/merchant/v3/transaction/${transactionId}/refund`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (response.status !== 202) {
        throw new Error('Refund request returned invalid status code');
      }

      return true;
    } catch (error: unknown) {
      log.error('Failed to create refund', error);

      return false;
    }
  }
}

/**
 * Initializes the EasyCredit client with configuration from utils.
 * @returns {EasyCreditClient} Initialized client instance.
 */
export const initEasyCreditClient = (): EasyCreditClient => {
  const config = readConfiguration().easyCredit;
  return new EasyCreditApiClient(config);
};
