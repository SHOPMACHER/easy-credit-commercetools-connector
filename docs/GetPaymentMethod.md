# Get Payment Method

For the terms in this document (EC, CT, easyCredit status values, cart freeze), see [Terms](./CommercetoolsFrontendIntegration.md#terms).

* [Workflow](#workflow)
* [Example request](#request)
* [Response Format](#response-format)
* [Error Handling](#error-responses)

## Overview
This API checks if an easyCredit payment type can be offered for a cart. It returns the data that the checkout component needs to show it: the webshop ID, the cart amount and the availability of each easyCredit payment type.

The checkout component calls it once for each payment method that it shows. It sends `paymentType=INSTALLMENT_PAYMENT` or `paymentType=BILL_PAYMENT`.

<br />

## Conditions

To use this function, these conditions must be true:

1. You give a valid `cartId` that belongs to a cart in CommerceTools.
2. The session is authenticated. The request has a valid session token.

<br />

## Workflow

1. **Fetch Cart by ID**: The connector gets the cart from CommerceTools with the `cartId`. If the requested payment type is off in the connector configuration (`INSTALLMENT_PAYMENT_ENABLED=0` or `BILL_PAYMENT_ENABLED=0`), the API returns `PaymentTypeNotAvailable`. It does not read the cart.
2. **Validate the cart and the requested payment type**: For both payment types, the connector first checks the availability of the requested type (activation, limits, excluded cart items). Then it checks the billing and shipping addresses and the currency. For `BILL_PAYMENT`, it also checks the customer (private persons only). The availability errors come first, so that an address or currency error does not hide them. For how the checkout component shows each error, see [Availability](./WebComponents.md#availability).
3. **Fetch webshop configuration**: The connector reads the activation status and limits of each payment type from the easyCredit webshop endpoint (`GET /payment/v3/webshop/{webShopId}`). See [Webshop configuration](#webshop-configuration).
4. **Resolve payment types**: For each payment type, the connector decides if it can offer the type for the cart total. See [Payment type availability](#payment-type-availability).
5. **Return Result**: The API returns `200` if it can offer the requested payment type. Otherwise it returns `400` (or `503`) with the reason. The response always reports the availability of both payment types.
   - The customer and address checks of pay by invoice run only for `paymentType=BILL_PAYMENT`. The payment type that you did not request is therefore reported only from its feature flag, the webshop configuration, the limits and its excluded cart items.
   - `POST /payments` runs the same check for the payment type that you send to it.
   - The reason can also be `InstallmentPaymentExcludedItems` or `InstallmentPaymentCheckFailed` for installment. It can be `BillPaymentExcludedItems` or `BillPaymentCheckFailed` for pay by invoice.

<br />

## Payment type availability

| Payment type | Offered if |
| --- | --- |
| `INSTALLMENT_PAYMENT` | `INSTALLMENT_PAYMENT_ENABLED` is `1` (default). `availability` and `installmentPaymentActive` are `true`. `minInstallmentValue <= amount <= maxInstallmentValue`. The cart has no line item whose product type key is in `INSTALLMENT_PAYMENT_EXCLUDED_PRODUCT_TYPES`. The cart has no custom line item whose `slug` or `key` is in `INSTALLMENT_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS`. The product type lookup succeeds, unless a matching excluded custom line item already rules out the cart (see [Excluded cart items](#excluded-cart-items)). |
| `BILL_PAYMENT` | `BILL_PAYMENT_ENABLED` is `1`. `availability` and `billPaymentActive` are `true`. `minBillingValue <= amount <= maxBillingValue`. The cart has no line item whose product type key is in `BILL_PAYMENT_EXCLUDED_PRODUCT_TYPES`. The cart has no custom line item whose `slug` or `key` is in `BILL_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS`. The product type lookup succeeds, unless a matching excluded custom line item already rules out the cart (see [Excluded cart items](#excluded-cart-items)). |

The connector offers pay by invoice only to private persons. It rejects a cart with a Business Unit or a `company` in the billing or shipping address with `CorporateCustomerNotAllowed`. For both payment types, the billing and shipping address must be identical and in Germany. Identical means the same `firstName`, `lastName`, `email`, `phone`, `mobile`, `streetName`, `streetNumber`, `additionalStreetInfo`, `postalCode`, `city` and `country`. For pay by invoice, this applies to every shipping address of the cart. This includes all addresses with `shippingMode: Multiple` and the item shipping addresses that line items ship to.

Both payment types also need a fresh easyCredit webshop configuration (see below). If both `INSTALLMENT_PAYMENT_ENABLED=0` and `BILL_PAYMENT_ENABLED=0`, the connector offers no easyCredit payment method. It logs a warning at startup.

easyCredit defines the limits for each webshop in EUR. You cannot configure them in the connector. There are no default limits. If the connector has no fresh webshop configuration, it offers no payment type.

<br />

## Excluded cart items

You can rule out each payment type for vouchers and other non-physical items. The merchant configures two lists for each payment type. Each type uses only its own lists:

| Payment type | Product type keys | Custom line item slugs or keys |
| --- | --- | --- |
| `INSTALLMENT_PAYMENT` | `INSTALLMENT_PAYMENT_EXCLUDED_PRODUCT_TYPES` | `INSTALLMENT_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS` |
| `BILL_PAYMENT` | `BILL_PAYMENT_EXCLUDED_PRODUCT_TYPES` | `BILL_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS` |

A cart with at least one line item of an excluded product type cannot use that payment type. This is true also if the cart has physical products. Use the custom line item list for items without a product type. Empty lists (the default) exclude nothing.

All lists are comma-separated. Each entry has at least 2 characters from `A-Z`, `a-z`, `0-9`, `_` and `-`. An invalid entry stops the connector at startup. The connector ignores spaces around entries, empty entries and duplicates.

The connector resolves the product type keys to ids in one query with the `view_product_types` scope. Keep the list short. The lookup always fails if the list has more than 500 keys or if the query URL is too long for commercetools. The lookup runs for each payment type. The connector caches each result for `WEBSHOP_CACHE_TTL` seconds:

- If a configured key does not exist, the connector logs a warning and does not cache the result. A product type that you create later then applies on the next request. Until you fix the key or create the product type, every check runs the query and logs the warning.
- If you delete a product type and create it again with the same key, it gets a new id. Its line items are excluded only after the cache expires or the connector restarts.

If the lookup fails (for example, because of a missing scope or a commercetools outage), the connector does not offer the payment type (fail closed, see [Terms](./CommercetoolsFrontendIntegration.md#terms)) and logs the error. A cart with a matching excluded custom line item is excluded without the lookup. That cart gets `InstallmentPaymentExcludedItems` or `BillPaymentExcludedItems`, never `InstallmentPaymentCheckFailed` or `BillPaymentCheckFailed`, also if the lookup would fail. The connector logs each exclusion at info level (`Payment type is excluded for the cart items`). The log has the cart ID, the payment type, the matching product type keys and the slugs of the matching custom line items.

| Payment type | Excluded items | Lookup failed |
| --- | --- | --- |
| `INSTALLMENT_PAYMENT` | `400 InstallmentPaymentExcludedItems` | `503 InstallmentPaymentCheckFailed` |
| `BILL_PAYMENT` | `400 BillPaymentExcludedItems` | `503 BillPaymentCheckFailed` |

The check runs only while the payment type is otherwise enabled. The connector checks the requested payment type in this call, in `POST /payments` and when the shopper switches to it on the easyCredit page. This call also checks the other payment type, but only to report it. An exclusion of the other type does not change the status of this call. It only sets `available` of that type to `false`.

<br />

## Webshop configuration

- The response, the retry window and the in-flight request are separate for each `webShopId`. The connector caches the response for `WEBSHOP_CACHE_TTL` seconds (default 300, max 3600).
- `installmentPaymentActive`, `minInstallmentValue` and `maxInstallmentValue` must be present with the correct type (boolean or number). Limits must not be negative. A minimum must not be above its maximum. Otherwise the connector treats the response as not valid.
- If `availability` is missing, the connector treats the webshop as available and logs a warning.
- The connector validates the bill payment fields `billPaymentActive`, `minBillingValue` and `maxBillingValue` separately. If one of them is missing, `null` or not valid (wrong type, negative, minimum above maximum), the connector does not offer bill payment. Installment is not affected.
- If the connector has no fresh response, it offers no payment type (fail closed). The API returns `503 EasyCreditUnavailable` with a `Retry-After` header. This covers a temporary failure (network error, timeout after 10 seconds, `5xx`, `408` or `429`), any other `4xx` (for example, revoked credentials) and an invalid installment configuration. The connector never reuses an expired response after a failed refresh. It logs the failure as an error.
- A fresh response that reports a deactivation returns `400 PaymentTypeNotAvailable` as usual.
- A failed request sets a 30-second window before the next background retry. Checkouts in that time get the last result. They get `503 EasyCreditUnavailable` and do not wait for easyCredit.

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

To get the `X-Session-Id`, see the [CommerceTools Sessions API documentation](https://docs.commercetools.com/checkout/installing-checkout#create-checkout-sessions).

<br />

### Response Format

#### Success Response (200):

The API returns this if it can offer the requested payment type. `INSTALLMENT_PAYMENT.available` is `true` only if `INSTALLMENT_PAYMENT_ENABLED=1`. `BILL_PAYMENT.available` is `true` only if `BILL_PAYMENT_ENABLED=1`.

```json
{
  "webShopId": "<WEBSHOP_ID>",
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
| `paymentTypes.<type>.available` | If the connector can offer the payment type for this cart. |
| `paymentTypes.<type>.minAmount` / `maxAmount` | Limits in EUR from the fresh webshop configuration. The API omits them for `BILL_PAYMENT` if a bill configuration field is missing or not valid, `null` included. |

#### Error Responses

| Status | Code | Reason |
| --- | --- | --- |
| 400 | `InvalidBillingAddress`, `InvalidShippingAddress`, `AddressesUnmatched`, `InvalidCurrency` | The cart addresses or currency are not valid. |
| 400 | `CorporateCustomerNotAllowed` | Only for `BILL_PAYMENT`: the cart has a Business Unit or a company in the billing or any shipping address. |
| 400 | `InvalidField` | `paymentType` is not `INSTALLMENT_PAYMENT` or `BILL_PAYMENT`. `fields` has the value that is not valid and the allowed values. |
| 400 | `InvalidAddress` | The billing address is not complete or not valid: `firstName`, `lastName`, `streetName` or `city` is blank, or `postalCode` does not have 5 digits. The API reports this in addition to the codes above if both addresses exist. |
| 400 | `InvalidAmount` | The cart total is outside the limits of the requested payment type. The message has the limits from the fresh webshop configuration. |
| 400 | `PaymentTypeNotAvailable` | The requested payment type is switched off or not activated: `INSTALLMENT_PAYMENT_ENABLED=0` or `BILL_PAYMENT_ENABLED=0`, or easyCredit reports `availability: false`, `installmentPaymentActive: false` or `billPaymentActive: false`. For `BILL_PAYMENT`, it also occurs if the bill configuration is missing or not valid. |
| 400 | `InstallmentPaymentExcludedItems`, `BillPaymentExcludedItems` | The cart has an excluded item for the requested payment type. See [Excluded cart items](#excluded-cart-items). This error comes before `InvalidAmount`. |
| 503 | `InstallmentPaymentCheckFailed`, `BillPaymentCheckFailed` | The connector could not load the excluded product types of the requested payment type from commercetools. This error comes before `InvalidAmount`. |
| 503 | `EasyCreditUnavailable` | There is no fresh easyCredit webshop configuration, for any payment type. easyCredit was not reachable, answered with an error or sent an invalid installment configuration. See [Webshop configuration](#webshop-configuration). `fields.webShopId` is set, so the checkout component can show the error. The `Retry-After` header has the seconds until the next retry. |

**`PaymentTypeNotAvailable` for pay by invoice:** first, make sure that `BILL_PAYMENT_ENABLED` is `1` in the connector. Then make sure that easyCredit activated pay by invoice for the webshop and that its bill configuration is valid. See [Webshop configuration](#webshop-configuration). The response is the same for all these causes.

The API never returns `InvalidAmount` and `PaymentTypeNotAvailable` together with an address, currency or customer error. For both payment types, the connector checks the cart only if the payment type is available.

Example for a webshop with installment limits of 200 € to 10.000 €:

```json
{
  "message": "Die Summe des Warenkorbs muss zwischen 200€ und 10.000€ liegen.",
  "statusCode": 400,
  "errors": [
    {
      "code": "InvalidAmount",
      "message": "Die Summe des Warenkorbs muss zwischen 200€ und 10.000€ liegen.",
      "fields": {
        "webShopId": "<WEBSHOP_ID>"
      }
    }
  ]
}
```
