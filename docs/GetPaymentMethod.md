# Get Payment Method

* [Workflow](#workflow)
* [Example request](#request)
* [Response Format](#response-format)
* [Error Handling](#error-responses)

## Overview
This API checks whether easyCredit can be offered for a cart and returns the data the checkout component needs to render it: the webshop ID, the cart amount and the availability of each easyCredit payment type.

<br />

## Conditions

To use this functionality, the following conditions must be met:

1. A valid `cartId` must be provided, corresponding to a cart in CommerceTools.
2. The session must be authenticated, and a valid session token must be included in the request.

<br />

## Workflow

1. **Fetch Cart by ID**: The cart is retrieved from CommerceTools using the provided `cartId`.
2. **Validate Cart**: The billing and shipping addresses and the currency are validated. If they are invalid, the API returns `400` without calling easyCredit.
3. **Fetch webshop configuration**: The activation status and limits of each payment type are read from the easyCredit webshop endpoint (`GET /payment/v3/webshop/{webShopId}`), see [Webshop configuration](#webshop-configuration).
4. **Resolve payment types**: For each payment type the connector decides whether it can be offered for the cart total, see [Payment type availability](#payment-type-availability).
5. **Return Result**: The checkout component currently only supports installment payment. The API returns `200` if `INSTALLMENT_PAYMENT` is available, otherwise `400` with the reason. `BILL_PAYMENT` is reported for information only and does not affect the result.

<br />

## Payment type availability

| Payment type | Offered if |
| --- | --- |
| `INSTALLMENT_PAYMENT` | `availability` and `installmentPaymentActive` are `true`, and `minInstallmentValue <= amount <= maxInstallmentValue` |
| `BILL_PAYMENT` | `BILL_PAYMENT_ENABLED` is `1`, `availability` and `billPaymentActive` are `true`, `minBillingValue <= amount <= maxBillingValue`, and the webshop configuration is not stale (see below) |

The limits are defined by easyCredit per webshop in EUR and cannot be configured in the connector.

<br />

## Webshop configuration

- The response, retry window and in-flight request are isolated per `webShopId`. The response is cached for `WEBSHOP_CACHE_TTL` seconds (default 300, max 3600).
- `installmentPaymentActive`, `minInstallmentValue` and `maxInstallmentValue` must be present with the correct type (boolean or number). Limits must not be negative and a minimum must not exceed its maximum. Otherwise the response is treated as invalid.
- If `availability` is missing, the webshop is treated as available and a warning is logged.
- The bill payment fields are optional; if any of them is missing, bill payment is not offered.
- If a refresh fails temporarily (network error, timeout after 10 seconds, `5xx`, `408` or `429`), the connector keeps using the last valid response for at most 1 hour after it expired and retries after 30 seconds. While this stale response is used, only installment payment can be offered; bill payment is not offered.
- If easyCredit answers with any other `4xx` (for example revoked credentials) or an invalid response, the last valid response is discarded.
- Without a usable response, the API returns `503 EasyCreditUnavailable` (fail closed) and retries easyCredit after 30 seconds at the earliest, so an outage does not slow down every checkout.

<br />

## Example URL Call

### Request

**HTTP Method:** `GET`
**URL:** `https://your-api-endpoint.com/payments/payment-method/{{cart_id}}`
**Headers:**
```http
X-Session-Id: <session_id>
Content-Type: application/json
```

To obtain the `X-Session-Id`, refer to the [CommerceTools Sessions API documentation](https://docs.commercetools.com/checkout/installing-checkout#create-checkout-sessions).

<br />

### Response Format

#### Success Response (200):

`BILL_PAYMENT.available` is only `true` if `BILL_PAYMENT_ENABLED=1`.

```json
{
  "webShopId": "2.de.7607.2",
  "amount": 500,
  "paymentTypes": {
    "INSTALLMENT_PAYMENT": {
      "available": true,
      "minAmount": 200,
      "maxAmount": 10000
    },
    "BILL_PAYMENT": {
      "available": true,
      "minAmount": 50,
      "maxAmount": 5000
    }
  }
}
```

| Field | Description |
| --- | --- |
| `webShopId` | easyCredit webshop ID from the connector configuration. |
| `amount` | Cart total in EUR. |
| `paymentTypes.<type>.available` | Whether the payment type can be offered for this cart. |
| `paymentTypes.<type>.minAmount` / `maxAmount` | Limits of the payment type in EUR as returned by easyCredit. Not set for `BILL_PAYMENT` if easyCredit does not return them. |

#### Error Responses

| Status | Code | Reason |
| --- | --- | --- |
| 400 | `InvalidBillingAddress`, `InvalidShippingAddress`, `AddressesUnmatched`, `InvalidCurrency` | The cart addresses or currency are invalid. |
| 400 | `InvalidAmount` | The cart total is outside the installment limits. The message contains the limits returned by easyCredit. |
| 400 | `PaymentTypeNotAvailable` | easyCredit reports `availability: false` or `installmentPaymentActive: false` for the webshop. |
| 503 | `EasyCreditUnavailable` | No usable webshop configuration, see [Webshop configuration](#webshop-configuration). `fields.webShopId` is set so the checkout component can show the error. |

The cart amount is only checked if the addresses and the currency are valid, so `InvalidAmount` is never returned together with an address or currency error.

Example for a webshop whose installment limits are 200 € to 10.000 €:

```json
{
  "message": "Die Summe des Warenkorbs muss zwischen 200€ und 10.000€ liegen.",
  "statusCode": 400,
  "errors": [
    {
      "code": "InvalidAmount",
      "message": "Die Summe des Warenkorbs muss zwischen 200€ und 10.000€ liegen.",
      "fields": {
        "webShopId": "2.de.7607.2"
      }
    }
  ]
}
```
