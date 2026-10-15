# Get Payment Method

* [Workflow](#workflow)
* [Example request](#request)
* [Response Format](#response-format)
* [Error Handling](#error-responses)

## Overview
This API checks whether an easyCredit payment type can be offered for a cart and returns the data the checkout component needs to render it: the webshop ID, the cart amount and the availability of each easyCredit payment type.

The checkout component calls it once per payment method it renders, with `paymentType=INSTALLMENT_PAYMENT` or `paymentType=BILL_PAYMENT`.

<br />

## Conditions

To use this functionality, the following conditions must be met:

1. A valid `cartId` must be provided, corresponding to a cart in CommerceTools.
2. The session must be authenticated, and a valid session token must be included in the request.

<br />

## Workflow

1. **Fetch Cart by ID**: The cart is retrieved from CommerceTools using the provided `cartId`.
2. **Validate the cart and the requested payment type**: The order of the checks depends on `paymentType`:
   - `INSTALLMENT_PAYMENT` (default): the billing and shipping addresses and the currency are validated first. If they are invalid, the API returns `400` without calling easyCredit. Then the availability of installment is checked.
   - `BILL_PAYMENT`: the availability of pay by invoice is checked first, then the addresses, the currency and the customer (private persons only). The checkout component hides pay by invoice only on availability errors, so they must take precedence over cart errors that it shows as an alert.
3. **Fetch webshop configuration**: The activation status and limits of each payment type are read from the easyCredit webshop endpoint (`GET /payment/v3/webshop/{webShopId}`), see [Webshop configuration](#webshop-configuration).
4. **Resolve payment types**: For each payment type the connector decides whether it can be offered for the cart total, see [Payment type availability](#payment-type-availability).
5. **Return Result**: The API returns `200` if the requested payment type can be offered, otherwise `400` (or `503`) with the reason. The response always reports the availability of both payment types. `POST /payments` runs the same check for the payment type it is called with. For `BILL_PAYMENT` the reason can also be `BillPaymentExcludedItems` or `BillPaymentCheckFailed`.

<br />

## Payment type availability

| Payment type | Offered if |
| --- | --- |
| `INSTALLMENT_PAYMENT` | `availability` and `installmentPaymentActive` are `true`, and `minInstallmentValue <= amount <= maxInstallmentValue` |
| `BILL_PAYMENT` | `BILL_PAYMENT_ENABLED` is `1`, `availability` and `billPaymentActive` are `true`, `minBillingValue <= amount <= maxBillingValue`, the webshop configuration is a fresh easyCredit response (see below), and the cart contains no line item whose product type key is in `BILL_PAYMENT_EXCLUDED_PRODUCT_TYPES` and no custom line item whose `slug` or `key` is in `BILL_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS`, and the product type lookup succeeds (see [Excluded cart items](#excluded-cart-items)) |

Pay by invoice is additionally only offered to private persons: a cart with a Business Unit or a `company` in the billing or shipping address is rejected with `CorporateCustomerNotAllowed`. For both payment types, billing and shipping address must be identical and in Germany.

The limits are defined by easyCredit per webshop in EUR and cannot be configured in the connector. During temporary failures, installment uses usable cached limits or, if none remain, the legacy 200 € to 10.000 € defaults, unless a known deactivation or permanent failure blocks fallback. Bill payment is unavailable with stale or default data (see below).

<br />

## Excluded cart items

Pay by invoice is only offered for physical goods. Vouchers and other non-physical items are configured by the merchant:

- `BILL_PAYMENT_EXCLUDED_PRODUCT_TYPES`: product type keys. A cart with at least one line item of such a product type cannot use `BILL_PAYMENT`, also if it contains physical products.
- `BILL_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS`: custom line item slugs or keys, for items without a product type.

Both lists are comma-separated. Each entry has at least 2 characters out of `A-Z`, `a-z`, `0-9`, `_` and `-`. An invalid entry stops the connector at startup. Spaces around entries, empty entries and duplicates are ignored.

The connector resolves the product type keys to ids in one query with the `view_product_types` scope, so keep the list short: with more than 500 keys, or a query URL that commercetools rejects as too long, the lookup always fails. The result is cached for `WEBSHOP_CACHE_TTL` seconds:

- If a configured key does not exist, it is logged as a warning and the result is not cached, so a product type created later applies on the next request. Until the key is fixed or the product type exists, every check runs the query and logs the warning.
- A product type that is deleted and created again with the same key gets a new id. Its line items are only excluded after the cache expires or the connector restarts.

If the lookup fails (for example a missing scope or a commercetools outage), `BILL_PAYMENT` is not offered (fail closed) and the error is logged. `POST /payments` then returns `503 BillPaymentCheckFailed`. A cart with a matching custom line item is excluded without the lookup. Each exclusion is logged at info level with the cart ID, the matching product type keys and the slugs of the matching custom line items.

The check only runs while `BILL_PAYMENT` is otherwise enabled, and only for this call and for `POST /payments` with `BILL_PAYMENT`. Installment payments are created without it. It does not change the status of this call: `BILL_PAYMENT.available` is `false`.

<br />

## Webshop configuration

- The response, retry window and in-flight request are isolated per `webShopId`. The response is cached for `WEBSHOP_CACHE_TTL` seconds (default 300, max 3600).
- `installmentPaymentActive`, `minInstallmentValue` and `maxInstallmentValue` must be present with the correct type (boolean or number). Limits must not be negative and a minimum must not exceed its maximum. Otherwise the response is treated as invalid.
- If `availability` is missing, the webshop is treated as available and a warning is logged.
- The bill payment fields `billPaymentActive`, `minBillingValue` and `maxBillingValue` are validated separately. If any of them is missing, `null` or invalid (wrong type, negative, minimum above maximum), bill payment is not offered. Installment is not affected.
- If a request fails temporarily (network error, timeout after 10 seconds, `5xx`, `408` or `429`):
  - with a valid response that expired less than 1 hour ago, the connector keeps using it,
  - otherwise installment is offered with the default limits 200 € to 10.000 €, unless a previous response disabled installment/the webshop or a previous request failed permanently (see below).

  In both cases bill payment is not offered.
- If easyCredit answers with any other `4xx` (for example revoked credentials) or an invalid installment configuration, the last valid response is discarded and the API returns `503 EasyCreditUnavailable` with a `Retry-After` header.
- A known deactivation or permanent failure blocks default installment fallback until a valid webshop response replaces it. This block is kept per `webShopId` in memory even after cached limits expire and across later network errors. Once disabled data exceeds the 1-hour stale limit, the connector returns `503 EasyCreditUnavailable` instead of enabling installment with defaults. A fresh response that still reports deactivation returns `400 PaymentTypeNotAvailable` as usual.
- A failed request normally sets a 30-second window before the next background retry; the window ends sooner if the stale-data deadline is reached. Checkouts in the meantime are answered from the last result and do not wait for easyCredit.

<br />

## Example URL Call

### Request

**HTTP Method:** `GET`
**URL:** `https://your-api-endpoint.com/payments/payment-method/{{cart_id}}?paymentType=BILL_PAYMENT`
**Query parameters:**

| Name | Required | Description |
| --- | --- | --- |
| `paymentType` | No | `INSTALLMENT_PAYMENT` (default) or `BILL_PAYMENT`. Any other value returns `400`. |

**Headers:**
```http
X-Session-Id: <session_id>
Content-Type: application/json
```

To obtain the `X-Session-Id`, refer to the [CommerceTools Sessions API documentation](https://docs.commercetools.com/checkout/installing-checkout#create-checkout-sessions).

<br />

### Response Format

#### Success Response (200):

Returned if the requested payment type can be offered. `BILL_PAYMENT.available` is only `true` if `BILL_PAYMENT_ENABLED=1`.

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
| `paymentTypes.<type>.minAmount` / `maxAmount` | Effective limits in EUR from fresh or usable stale webshop data, or the installment defaults. Omitted for `BILL_PAYMENT` if any bill configuration field is absent or invalid, including `null`. |

#### Error Responses

| Status | Code | Reason |
| --- | --- | --- |
| 400 | `InvalidBillingAddress`, `InvalidShippingAddress`, `AddressesUnmatched`, `InvalidCurrency` | The cart addresses or currency are invalid. |
| 400 | `CorporateCustomerNotAllowed` | Only for `BILL_PAYMENT`: the cart has a Business Unit or a company in the billing or shipping address. |
| 400 | `InvalidAddress` | The billing address is incomplete or invalid: `firstName`, `lastName`, `streetName` and `city` must not be blank and `postalCode` must be 5 digits. Reported in addition to the codes above if both addresses exist. |
| 400 | `InvalidAmount` | The cart total is outside the effective limits of the requested payment type. The message contains the limits from fresh or usable stale webshop data, or the installment defaults. |
| 400 | `PaymentTypeNotAvailable` | The requested payment type is not activated: easyCredit reports `availability: false`, `installmentPaymentActive: false` or `billPaymentActive: false`. For `BILL_PAYMENT` also if `BILL_PAYMENT_ENABLED=0`, the bill configuration is missing or invalid, or only stale or default webshop data is available. |
| 503 | `EasyCreditUnavailable` | easyCredit rejected the request (`4xx` other than `408`/`429`), sent an invalid installment configuration, or a previous deactivation/permanent failure still blocks fallback without usable cached data; see [Webshop configuration](#webshop-configuration). `fields.webShopId` is set so the checkout component can show the error. The `Retry-After` header contains the seconds until the next retry. |

`InvalidAmount` and `PaymentTypeNotAvailable` are never returned together with an address, currency or customer error:

- for `INSTALLMENT_PAYMENT`, availability is only checked if the cart is valid,
- for `BILL_PAYMENT`, the cart is only checked if pay by invoice is available.

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
