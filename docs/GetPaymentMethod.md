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

1. **Fetch Cart by ID**: The cart is retrieved from CommerceTools using the provided `cartId`. If the requested payment type is switched off in the connector (`INSTALLMENT_PAYMENT_ENABLED=0` or `BILL_PAYMENT_ENABLED=0`), the API returns `PaymentTypeNotAvailable` without reading the cart. If the cart of the session still holds the placeholder address of an express attempt that is over (`DECLINED`, `EXPIRED` or unknown to easyCredit), that attempt is ended and the cart released first. This changes the cart, see [Abandoned attempt](./CreateExpressPayment.md#abandoned-attempt). An attempt the shopper can still finish is kept, and the check reports the placeholder like any incomplete address.
2. **Validate the cart and the requested payment type**: For both payment types the availability of the requested type (activation, limits, excluded cart items) is checked first, then the billing and shipping addresses and the currency. For `BILL_PAYMENT` the customer is checked too (private persons only). The checkout component hides a payment type only on availability errors, so they must take precedence over cart errors that it shows as an alert.
3. **Fetch webshop configuration**: The activation status and limits of each payment type are read from the easyCredit webshop endpoint (`GET /payment/v3/webshop/{webShopId}`), see [Webshop configuration](#webshop-configuration).
4. **Resolve payment types**: For each payment type the connector decides whether it can be offered for the cart total, see [Payment type availability](#payment-type-availability).
5. **Return Result**: The API returns `200` if the requested payment type can be offered, otherwise `400` (or `503`) with the reason. The response always reports the availability of both payment types. The customer and address checks of pay by invoice only run for `paymentType=BILL_PAYMENT`, so the payment type that was not requested is reported from its feature flag, the webshop configuration, the limits and its excluded cart items only. `POST /payments` runs the same check for the payment type it is called with. The reason can also be `InstallmentPaymentExcludedItems` or `InstallmentPaymentCheckFailed` for installment, and `BillPaymentExcludedItems` or `BillPaymentCheckFailed` for pay by invoice.

<br />

## Payment type availability

| Payment type | Offered if |
| --- | --- |
| `INSTALLMENT_PAYMENT` | `INSTALLMENT_PAYMENT_ENABLED` is `1` (default), `availability` and `installmentPaymentActive` are `true`, `minInstallmentValue <= amount <= maxInstallmentValue`, and the cart contains no line item whose product type key is in `INSTALLMENT_PAYMENT_EXCLUDED_PRODUCT_TYPES` and no custom line item whose `slug` or `key` is in `INSTALLMENT_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS`, and the product type lookup succeeds (see [Excluded cart items](#excluded-cart-items)) |
| `BILL_PAYMENT` | `BILL_PAYMENT_ENABLED` is `1`, `availability` and `billPaymentActive` are `true`, `minBillingValue <= amount <= maxBillingValue`, and the cart contains no line item whose product type key is in `BILL_PAYMENT_EXCLUDED_PRODUCT_TYPES` and no custom line item whose `slug` or `key` is in `BILL_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS`, and the product type lookup succeeds (see [Excluded cart items](#excluded-cart-items)) |

Pay by invoice is additionally only offered to private persons: a cart with a Business Unit or a `company` in the billing or shipping address is rejected with `CorporateCustomerNotAllowed`. For both payment types, billing and shipping address must be identical and in Germany. Identical means the same `firstName`, `lastName`, `email`, `phone`, `mobile`, `streetName`, `streetNumber`, `additionalStreetInfo`, `postalCode`, `city` and `country`. For pay by invoice this applies to every shipping address of the cart, including all addresses with `shippingMode: Multiple` and the item shipping addresses that line items are shipped to.

Both payment types also require a fresh easyCredit webshop configuration (see below). With both `INSTALLMENT_PAYMENT_ENABLED=0` and `BILL_PAYMENT_ENABLED=0` no easyCredit payment method is offered, and the connector logs a warning at startup.

The limits are defined by easyCredit per webshop in EUR and cannot be configured in the connector. There are no default limits: if the connector has no fresh webshop configuration, no payment type is offered.

<br />

## Excluded cart items

Each payment type can be ruled out for vouchers and other non-physical items. The merchant configures two lists per payment type, and each type only uses its own lists:

| Payment type | Product type keys | Custom line item slugs or keys |
| --- | --- | --- |
| `INSTALLMENT_PAYMENT` | `INSTALLMENT_PAYMENT_EXCLUDED_PRODUCT_TYPES` | `INSTALLMENT_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS` |
| `BILL_PAYMENT` | `BILL_PAYMENT_EXCLUDED_PRODUCT_TYPES` | `BILL_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS` |

A cart with at least one line item of an excluded product type cannot use that payment type, also if it contains physical products. The custom line item list is for items without a product type. Empty lists (the default) exclude nothing.

All lists are comma-separated. Each entry has at least 2 characters out of `A-Z`, `a-z`, `0-9`, `_` and `-`. An invalid entry stops the connector at startup. Spaces around entries, empty entries and duplicates are ignored.

The connector resolves the product type keys to ids in one query with the `view_product_types` scope, so keep the list short: with more than 500 keys, or a query URL that commercetools rejects as too long, the lookup always fails. The lookup runs per payment type, and each result is cached for `WEBSHOP_CACHE_TTL` seconds:

- If a configured key does not exist, it is logged as a warning and the result is not cached, so a product type created later applies on the next request. Until the key is fixed or the product type exists, every check runs the query and logs the warning.
- A product type that is deleted and created again with the same key gets a new id. Its line items are only excluded after the cache expires or the connector restarts.

If the lookup fails (for example a missing scope or a commercetools outage), the payment type is not offered (fail closed) and the error is logged. A cart with a matching custom line item is excluded without the lookup. Each exclusion is logged at info level (`Payment type is excluded for the cart items`) with the cart ID, the payment type, the matching product type keys and the slugs of the matching custom line items.

| Payment type | Excluded items | Lookup failed |
| --- | --- | --- |
| `INSTALLMENT_PAYMENT` | `400 InstallmentPaymentExcludedItems` | `503 InstallmentPaymentCheckFailed` |
| `BILL_PAYMENT` | `400 BillPaymentExcludedItems` | `503 BillPaymentCheckFailed` |

The check only runs while the payment type is otherwise enabled. The requested payment type is checked in this call, in `POST /payments` and when the shopper switches to it on the easyCredit page. This call also checks the other payment type, but only to report it: an exclusion of the other type does not change the status of this call, it only sets `available` of that type to `false`.

<br />

## Webshop configuration

- The response, retry window and in-flight request are isolated per `webShopId`. The response is cached for `WEBSHOP_CACHE_TTL` seconds (default 300, max 3600).
- `installmentPaymentActive`, `minInstallmentValue` and `maxInstallmentValue` must be present with the correct type (boolean or number). Limits must not be negative and a minimum must not exceed its maximum. Otherwise the response is treated as invalid.
- If `availability` is missing, the webshop is treated as available and a warning is logged.
- The bill payment fields `billPaymentActive`, `minBillingValue` and `maxBillingValue` are validated separately. If any of them is missing, `null` or invalid (wrong type, negative, minimum above maximum), bill payment is not offered. Installment is not affected.
- If the connector has no fresh response, no payment type is offered (fail closed) and the API returns `503 EasyCreditUnavailable` with a `Retry-After` header. This covers a temporary failure (network error, timeout after 10 seconds, `5xx`, `408` or `429`), any other `4xx` (for example revoked credentials) and an invalid installment configuration. An expired response is never reused after a failed refresh. The failure is logged as an error.
- A fresh response that reports a deactivation returns `400 PaymentTypeNotAvailable` as usual.
- A failed request sets a 30-second window before the next background retry. Checkouts in the meantime are answered from the last result, so they get `503 EasyCreditUnavailable` and do not wait for easyCredit.

<br />

## Example URL Call

### Request

**HTTP Method:** `GET`
**URL:** `https://your-api-endpoint.com/payments/payment-method/{{cart_id}}?paymentType=BILL_PAYMENT`
**Query parameters:**

| Name | Required | Description |
| --- | --- | --- |
| `paymentType` | No | `INSTALLMENT_PAYMENT` (default) or `BILL_PAYMENT`. Any other value returns `400 InvalidField`. |

**Headers:**
```http
X-Session-Id: <session_id>
Content-Type: application/json
```

To obtain the `X-Session-Id`, refer to the [CommerceTools Sessions API documentation](https://docs.commercetools.com/checkout/installing-checkout#create-checkout-sessions).

<br />

### Response Format

#### Success Response (200):

Returned if the requested payment type can be offered. `INSTALLMENT_PAYMENT.available` is only `true` if `INSTALLMENT_PAYMENT_ENABLED=1`, and `BILL_PAYMENT.available` only if `BILL_PAYMENT_ENABLED=1`.

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
| `paymentTypes.<type>.minAmount` / `maxAmount` | Limits in EUR from the fresh webshop configuration. Omitted for `BILL_PAYMENT` if any bill configuration field is absent or invalid, including `null`. |

#### Error Responses

| Status | Code | Reason |
| --- | --- | --- |
| 400 | `InvalidBillingAddress`, `InvalidShippingAddress`, `AddressesUnmatched`, `InvalidCurrency` | The cart addresses or currency are invalid. |
| 400 | `CorporateCustomerNotAllowed` | Only for `BILL_PAYMENT`: the cart has a Business Unit or a company in the billing or any shipping address. |
| 400 | `InvalidField` | `paymentType` is not `INSTALLMENT_PAYMENT` or `BILL_PAYMENT`. `fields` contains the invalid value and the allowed values. |
| 400 | `InvalidAddress` | The billing address is incomplete or invalid: `firstName`, `lastName`, `streetName` and `city` must not be blank and `postalCode` must be 5 digits. Reported in addition to the codes above if both addresses exist. |
| 400 | `InvalidAmount` | The cart total is outside the limits of the requested payment type. The message contains the limits from the fresh webshop configuration. |
| 400 | `PaymentTypeNotAvailable` | The requested payment type is switched off or not activated: `INSTALLMENT_PAYMENT_ENABLED=0` or `BILL_PAYMENT_ENABLED=0`, or easyCredit reports `availability: false`, `installmentPaymentActive: false` or `billPaymentActive: false`. For `BILL_PAYMENT` also if the bill configuration is missing or invalid. |
| 400 | `InstallmentPaymentExcludedItems`, `BillPaymentExcludedItems` | The cart contains an excluded item for the requested payment type, see [Excluded cart items](#excluded-cart-items). Takes precedence over `InvalidAmount`. |
| 503 | `InstallmentPaymentCheckFailed`, `BillPaymentCheckFailed` | The excluded product types of the requested payment type could not be loaded from commercetools. Takes precedence over `InvalidAmount`. |
| 503 | `EasyCreditUnavailable` | There is no fresh easyCredit webshop configuration, for any payment type: easyCredit could not be reached, answered with an error or sent an invalid installment configuration; see [Webshop configuration](#webshop-configuration). `fields.webShopId` is set so the checkout component can show the error. The `Retry-After` header contains the seconds until the next retry. |

`InvalidAmount` and `PaymentTypeNotAvailable` are never returned together with an address, currency or customer error: for both payment types the cart is only checked if the payment type is available.

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
