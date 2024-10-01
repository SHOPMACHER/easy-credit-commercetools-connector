import { readConfiguration } from '../utils/config.utils';
import { EASYCREDIT_BASE_API_URL } from '../utils/constant.utils';

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

  return {
    integrationCheck,
  };
};
