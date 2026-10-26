import { readConfiguration } from '../utils/config.utils';
import {
  EASYCREDIT_BASE_API_URL,
  EASYCREDIT_PARTNER_BASE_API_URL,
  EASYCREDIT_WEBSHOP_INFO_TIMEOUT_MS,
} from '../utils/constant.utils';
import {
  ECCreatePaymentResponse,
  ECGetMerchantTransactionResponse,
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
  authorizePayment(
    technicalTransactionId: string,
    orderId: string,
    signal?: AbortSignal,
    customHeaders?: HeadersInit,
  ): Promise<boolean>;
  capturePayment(
    transactionId: string,
    orderId: string,
    trackingNumber?: string,
    customHeaders?: HeadersInit,
  ): Promise<void>;
  getPayment(
    technicalTransactionId: string,
    signal?: AbortSignal,
    customHeaders?: HeadersInit,
  ): Promise<ECGetPaymentResponse>;
  refundPayment(transactionId: string, payload: ECRefundPayload, customHeaders?: HeadersInit): Promise<void>;
  getMerchantTransaction(transactionId: string): Promise<ECGetMerchantTransactionResponse>;
  getWebshopInfo(): Promise<unknown>;
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

  private async handleResponse<T>(
    response: Response,
    fallbackCode = 'Unknown Error',
    fallbackMessage = 'An error occurred',
  ): Promise<T> {
    if (!response.ok) {
      // Gateways can answer with null or a non-JSON body, which must not hide the status code.
      const errorData: Partial<ECTransactionError> = (await response.json().catch(() => ({}))) ?? {};
      log.error('EasyCredit API error', errorData);
      // An empty title must still produce a usable code and message.
      const title = typeof errorData.title === 'string' ? errorData.title.trim() : undefined;
      throw new Errorx({
        code: title?.length ? title : fallbackCode,
        message: title?.length ? title : fallbackMessage,
        httpErrorStatus: response.status,
        fields: errorData.violations,
      });
    }
    return response.json();
  }

  // easyCredit answers 202 when it accepted an asynchronous request; anything else must reach the caller as an error.
  private async postAccepted(
    url: string,
    body: object,
    failure: { code: string; message: string; logMessage: string },
    signal?: AbortSignal,
    customHeaders?: HeadersInit,
  ): Promise<void> {
    const headers = { ...this.getDefaultHeaders(), ...customHeaders };
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        ...(signal && { signal }),
      });
    } catch (error: unknown) {
      log.error(failure.logMessage, error);
      // DOMException is not always an Error instance across realms, so match on the name only.
      const name = (error as { name?: string } | null)?.name;
      const aborted = name === 'AbortError' || name === 'TimeoutError';
      throw new Errorx({ code: failure.code, message: failure.message, httpErrorStatus: aborted ? 504 : 502 });
    }

    if (response.status !== 202) {
      if (!response.ok) {
        await this.handleResponse(response, failure.code, failure.message);
      }
      // A 2xx other than 202 is no accepted request either. Answer 502, a 2xx error reply could be read as success.
      throw new Errorx({ code: failure.code, message: failure.message, httpErrorStatus: 502 });
    }
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
    signal?: AbortSignal,
    customHeaders?: HeadersInit,
  ): Promise<boolean> {
    await this.postAccepted(
      `${this.baseApiUrl}/payment/v3/transaction/${technicalTransactionId}/authorization`,
      orderId ? { orderId } : {},
      { code: 'AuthorizationFailed', message: 'Authorization failed', logMessage: 'Failed to authorize the payment' },
      signal,
      customHeaders,
    );

    return true;
  }

  public async capturePayment(
    transactionId: string,
    orderId: string,
    trackingNumber?: string,
    customHeaders?: HeadersInit,
  ): Promise<void> {
    await this.postAccepted(
      `${this.partnerBaseApiUrl}/merchant/v3/transaction/${transactionId}/capture`,
      { orderId, trackingNumber },
      { code: 'CaptureFailed', message: 'Capture failed', logMessage: 'Failed to capture the payment' },
      undefined,
      customHeaders,
    );
  }

  public async getPayment(
    technicalTransactionId: string,
    signal?: AbortSignal,
    customHeaders?: HeadersInit,
  ): Promise<ECGetPaymentResponse> {
    const headers = { ...this.getDefaultHeaders(), ...customHeaders };
    const response = await fetch(`${this.baseApiUrl}/payment/v3/transaction/${technicalTransactionId}`, {
      method: 'GET',
      headers,
      ...(signal && { signal }),
    });
    return this.handleResponse(response);
  }

  public async refundPayment(
    transactionId: string,
    payload: ECRefundPayload,
    customHeaders?: HeadersInit,
  ): Promise<void> {
    await this.postAccepted(
      `${this.partnerBaseApiUrl}/merchant/v3/transaction/${transactionId}/refund`,
      payload,
      { code: 'RefundFailed', message: 'Refund failed', logMessage: 'Failed to create refund' },
      undefined,
      customHeaders,
    );
  }

  public async getMerchantTransaction(transactionId: string): Promise<ECGetMerchantTransactionResponse> {
    const headers: HeadersInit = { ...this.getDefaultHeaders() };

    const response = await fetch(`${this.partnerBaseApiUrl}/merchant/v3/transaction/${transactionId}`, {
      method: 'GET',
      headers,
    });

    return await this.handleResponse(response);
  }

  public async getWebshopInfo(): Promise<unknown> {
    const response = await fetch(`${this.baseApiUrl}/payment/v3/webshop/${this.config.webShopId}`, {
      method: 'GET',
      headers: this.getDefaultHeaders(),
      // Checkout requests wait on this call, so don't let a hanging easyCredit API block them.
      signal: AbortSignal.timeout(EASYCREDIT_WEBSHOP_INFO_TIMEOUT_MS),
    });

    return await this.handleResponse(response);
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
