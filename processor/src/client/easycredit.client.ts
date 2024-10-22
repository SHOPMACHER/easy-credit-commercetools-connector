import { readConfiguration } from '../utils/config.utils';
import { EASYCREDIT_BASE_API_URL } from '../utils/constant.utils';
import {
  ECCreatePaymentResponse,
  ECGetPaymentResponse,
  ECTransaction,
  ECTransactionError,
} from '../types/payment.types';
import { Errorx } from '@commercetools/connect-payments-sdk';

/**
 * Initializes the EasyCredit client
 *
 * @example
 * const { integrationCheck } = initEasyCreditClient();
 * const response = await integrationCheck({ ... });
 */
export const initEasyCreditClient = () => {
  const config = readConfiguration();

  const webShopId = config.easyCredit.webShopId;
  const apiPassword = config.easyCredit.apiPassword;

  /**
   * Generates default headers for the EasyCredit API requests, including the Authorization header set to Basic Auth with the webShopId and apiPassword.
   * @returns Default headers for the EasyCredit API requests.
   */
  const getDefaultHeaders = (): HeadersInit => {
    return {
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${webShopId}:${apiPassword}`)}`,
    };
  };

  const integrationCheck = async (payload: object | JSON, customHeaders?: HeadersInit) => {
    const headers: HeadersInit = { ...getDefaultHeaders(), ...customHeaders };

    const response = await fetch(`${EASYCREDIT_BASE_API_URL}/payment/v3/webshop/integrationcheck`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    return await response.json();
  };

  const createPayment = async (
    payload: ECTransaction,
    customHeaders?: HeadersInit,
  ): Promise<ECCreatePaymentResponse> => {
    const headers: HeadersInit = { ...getDefaultHeaders(), ...customHeaders };

    try {
      const response = await fetch(`${EASYCREDIT_BASE_API_URL}/payment/v3/transaction`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw await response.json();
      }

      return await response.json();
    } catch (error: unknown) {
      console.error('Error in easycredit createPayment', error);

      throw new Errorx({
        code: (error as ECTransactionError).title,
        message: (error as ECTransactionError).title,
        httpErrorStatus: 400,
        fields: (error as ECTransactionError).violations,
      });
    }
  };

  const authorizePayment = async (technicalTransactionId: string, customHeaders?: HeadersInit) => {
    const headers: HeadersInit = { ...getDefaultHeaders(), ...customHeaders };

    const response = await fetch(
      `${EASYCREDIT_BASE_API_URL}/payment/v3/transaction/${technicalTransactionId}/authorization`,
      {
        method: 'POST',
        headers,
      },
    );

    return await response.json();
  };

  const getPayment = async (
    technicalTransactionId: string,
    customHeaders?: HeadersInit,
  ): Promise<ECGetPaymentResponse> => {
    try {
      const headers: HeadersInit = { ...getDefaultHeaders(), ...customHeaders };

      const response = await fetch(`${EASYCREDIT_BASE_API_URL}/payment/v3/transaction/${technicalTransactionId}`, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        throw await response.json();
      }

      return await response.json();
    } catch (error: unknown) {
      console.error('Error in easycredit getPayment', error);

      throw new Errorx({
        code: (error as ECTransactionError).title,
        message: (error as ECTransactionError).title,
        httpErrorStatus: 400,
        fields: (error as ECTransactionError).violations,
      });
    }
  };

  return {
    integrationCheck,
    createPayment,
    authorizePayment,
    getPayment,
  };
};
